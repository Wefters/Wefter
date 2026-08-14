import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const SIMCTL_LIST_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
      { udid: "AAA-1", name: "iPhone SE (3rd generation)", state: "Shutdown", isAvailable: true },
      { udid: "AAA-2", name: "iPhone 15", state: "Booted", isAvailable: true },
      { udid: "AAA-3", name: "iPhone 15 Pro", state: "Shutdown", isAvailable: false },
    ],
    "com.apple.CoreSimulator.SimRuntime.watchOS-10-5": [
      { udid: "BBB-1", name: "Apple Watch Series 9 (45mm)", state: "Shutdown", isAvailable: true },
    ],
  },
});

const execFileMock = vi.fn((_cmd: string, _args: string[], cb: (err: Error | null, stdout: string) => void) => {
  cb(null, SIMCTL_LIST_JSON);
});
const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: [string, string[], (err: Error | null, stdout: string) => void]) => execFileMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

function fakeSpawn(exitCode: number) {
  spawnMock.mockImplementationOnce(() => {
    const emitter = new EventEmitter();
    queueMicrotask(() => emitter.emit("exit", exitCode));
    return emitter;
  });
}

afterEach(() => {
  spawnMock.mockReset();
});

describe("findSimulator", () => {
  it("finds a device by exact name", async () => {
    const { findSimulator } = await import("../src/native/ios-run.js");
    const device = findSimulator(SIMCTL_LIST_JSON, "iPhone 15");
    expect(device?.udid).toBe("AAA-2");
  });

  it("finds a device by UDID", async () => {
    const { findSimulator } = await import("../src/native/ios-run.js");
    const device = findSimulator(SIMCTL_LIST_JSON, "AAA-1");
    expect(device?.name).toBe("iPhone SE (3rd generation)");
  });

  it("returns null for a name that matches nothing", async () => {
    const { findSimulator } = await import("../src/native/ios-run.js");
    expect(findSimulator(SIMCTL_LIST_JSON, "iPhone 99")).toBeNull();
  });
});

describe("pickDefaultSimulator", () => {
  it("picks the first available iPhone simulator, skipping unavailable ones", async () => {
    const { pickDefaultSimulator } = await import("../src/native/ios-run.js");
    expect(pickDefaultSimulator(SIMCTL_LIST_JSON)).toBe("iPhone SE (3rd generation)");
  });

  it("never picks a non-iPhone device (e.g. an Apple Watch simulator)", async () => {
    const { pickDefaultSimulator } = await import("../src/native/ios-run.js");
    const onlyWatch = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.watchOS-10-5": [
          { udid: "BBB-1", name: "Apple Watch Series 9 (45mm)", state: "Shutdown", isAvailable: true },
        ],
      },
    });
    expect(pickDefaultSimulator(onlyWatch)).toBeNull();
  });

  it("returns null when there are no available iPhone simulators at all", async () => {
    const { pickDefaultSimulator } = await import("../src/native/ios-run.js");
    const noneAvailable = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
          { udid: "AAA-3", name: "iPhone 15 Pro", state: "Shutdown", isAvailable: false },
        ],
      },
    });
    expect(pickDefaultSimulator(noneAvailable)).toBeNull();
  });
});

describe("resolveSimulator", () => {
  it("returns the caller's requested simulator name when it exists", async () => {
    const { resolveSimulator } = await import("../src/native/ios-run.js");
    await expect(resolveSimulator("iPhone 15")).resolves.toBe("iPhone 15");
  });

  it("throws clearly when the requested simulator doesn't exist", async () => {
    const { resolveSimulator } = await import("../src/native/ios-run.js");
    await expect(resolveSimulator("iPhone 99")).rejects.toThrow(/No simulator found matching "iPhone 99"/);
  });

  it("picks a default when none is requested", async () => {
    const { resolveSimulator } = await import("../src/native/ios-run.js");
    await expect(resolveSimulator()).resolves.toBe("iPhone SE (3rd generation)");
  });
});

describe("installAndLaunchIos", () => {
  it("boots the simulator first when it isn't already Booted, then installs and launches", async () => {
    const { installAndLaunchIos } = await import("../src/native/ios-run.js");

    fakeSpawn(0);
    fakeSpawn(0);
    fakeSpawn(0);

    await installAndLaunchIos("/fake/WefterBridge.app", "com.example.app", "iPhone SE (3rd generation)");

    expect(spawnMock).toHaveBeenNthCalledWith(1, "xcrun", ["simctl", "boot", "AAA-1"], expect.any(Object));
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "xcrun",
      ["simctl", "install", "iPhone SE (3rd generation)", "/fake/WefterBridge.app"],
      expect.any(Object),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      "xcrun",
      ["simctl", "launch", "iPhone SE (3rd generation)", "com.example.app"],
      expect.any(Object),
    );
  });

  it("does not attempt to boot a simulator that's already Booted", async () => {
    const { installAndLaunchIos } = await import("../src/native/ios-run.js");

    fakeSpawn(0);
    fakeSpawn(0);

    await installAndLaunchIos("/fake/WefterBridge.app", "com.example.app", "iPhone 15");

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "xcrun",
      ["simctl", "install", "iPhone 15", "/fake/WefterBridge.app"],
      expect.any(Object),
    );
  });

  it("rejects clearly when simctl install fails", async () => {
    const { installAndLaunchIos } = await import("../src/native/ios-run.js");

    fakeSpawn(1);

    await expect(installAndLaunchIos("/fake/WefterBridge.app", "com.example.app", "iPhone 15")).rejects.toThrow(
      /simctl install.*exit code 1/,
    );
  });
});
