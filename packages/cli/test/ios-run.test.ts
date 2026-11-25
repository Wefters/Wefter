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

  it("disambiguates a name shared across runtimes: booted first, then newest runtime", async () => {
    const { findSimulator } = await import("../src/native/ios-run.js");
    const dupes = (bootedUdid?: string) =>
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
            {
              udid: "SE-17",
              name: "iPhone SE (3rd generation)",
              state: bootedUdid === "SE-17" ? "Booted" : "Shutdown",
              isAvailable: true,
            },
          ],
          "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
            { udid: "SE-26", name: "iPhone SE (3rd generation)", state: "Shutdown", isAvailable: true },
          ],
        },
      });
    expect(findSimulator(dupes(), "iPhone SE (3rd generation)")?.udid).toBe("SE-26");
    expect(findSimulator(dupes("SE-17"), "iPhone SE (3rd generation)")?.udid).toBe("SE-17");
  });

  it("returns null for a name that matches nothing", async () => {
    const { findSimulator } = await import("../src/native/ios-run.js");
    expect(findSimulator(SIMCTL_LIST_JSON, "iPhone 99")).toBeNull();
  });
});

describe("pickDefaultSimulator", () => {
  it("prefers an already-booted iPhone simulator", async () => {
    const { pickDefaultSimulator } = await import("../src/native/ios-run.js");
    expect(pickDefaultSimulator(SIMCTL_LIST_JSON)?.udid).toBe("AAA-2");
  });

  it("with nothing booted, picks an available iPhone from the newest iOS runtime", async () => {
    const { pickDefaultSimulator } = await import("../src/native/ios-run.js");
    const multiRuntime = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
          { udid: "OLD-SE", name: "iPhone SE (3rd generation)", state: "Shutdown", isAvailable: true },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
          { udid: "NEW-PRO", name: "iPhone 17 Pro", state: "Shutdown", isAvailable: true },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-18-1": [
          { udid: "MID-16", name: "iPhone 16", state: "Shutdown", isAvailable: false },
        ],
      },
    });
    expect(pickDefaultSimulator(multiRuntime)?.udid).toBe("NEW-PRO");
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
  it("returns the caller's requested simulator when it exists", async () => {
    const { resolveSimulator } = await import("../src/native/ios-run.js");
    await expect(resolveSimulator("iPhone 15")).resolves.toMatchObject({ udid: "AAA-2", name: "iPhone 15" });
  });

  it("throws clearly when the requested simulator doesn't exist", async () => {
    const { resolveSimulator } = await import("../src/native/ios-run.js");
    await expect(resolveSimulator("iPhone 99")).rejects.toThrow(/No simulator found matching "iPhone 99"/);
  });

  it("picks a default (the booted iPhone) when none is requested", async () => {
    const { resolveSimulator } = await import("../src/native/ios-run.js");
    await expect(resolveSimulator()).resolves.toMatchObject({ udid: "AAA-2", name: "iPhone 15" });
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
      ["simctl", "install", "AAA-1", "/fake/WefterBridge.app"],
      expect.any(Object),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      "xcrun",
      ["simctl", "launch", "AAA-1", "com.example.app"],
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
      ["simctl", "install", "AAA-2", "/fake/WefterBridge.app"],
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
