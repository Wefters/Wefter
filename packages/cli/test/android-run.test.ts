import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { installAndroidApp, launchAndroidApp, restartAndroidApp } = await import("../src/native/android-run.js");
const { ProcessFailure } = await import("../src/process/run-process.js");
const { configureUi, setTerminalStreams } = await import("../src/ui/terminal.js");

const target = { serial: "R58N12ABC", appId: "dev.wefter.demo", namespace: "dev.wefter" };

/** Queues an `adb` invocation that prints `output` and exits with `code`. */
function adbResponds(output: string, code = 0) {
  spawnMock.mockImplementationOnce(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    queueMicrotask(() => {
      if (output) child.stdout.emit("data", Buffer.from(output));
      child.emit("exit", code);
      child.emit("close", code);
    });
    return child;
  });
}

beforeEach(() => {
  setTerminalStreams({ out: () => {}, err: () => {}, columns: () => 80 });
  configureUi({ debug: false, interactive: false });
});

afterEach(() => {
  spawnMock.mockReset();
  setTerminalStreams(null);
});

describe("installAndroidApp", () => {
  it("installs (replacing any existing copy) on the chosen device", async () => {
    adbResponds("Performing Streamed Install\nSuccess\n");

    await installAndroidApp(target, "/out/app-development-debug.apk");

    expect(spawnMock).toHaveBeenCalledWith(
      "adb",
      ["-s", "R58N12ABC", "install", "-r", "/out/app-development-debug.apk"],
      expect.any(Object),
    );
  });

  it("explains a failed install, using this device and app in the fix", async () => {
    adbResponds(
      "Performing Streamed Install\nadb: failed to install /out/app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package dev.wefter.demo signatures do not match newer version; ignoring!]\n",
      1,
    );

    const error = (await installAndroidApp(target, "/out/app.apk").catch((e: unknown) => e)) as InstanceType<
      typeof ProcessFailure
    >;

    expect(error).toBeInstanceOf(ProcessFailure);
    expect(error.tool).toBe("adb");
    expect(error.diagnosis.errors[0]).toMatch(/^INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package/);
    expect(error.diagnosis.hints).toEqual([
      "The installed app was signed with a different key. Uninstall it first: adb -s R58N12ABC uninstall dev.wefter.demo",
    ]);
  });

  it("treats “Failure [...]” as a failure even when adb exits 0 (older adb / vendor builds)", async () => {
    adbResponds("Performing Push Install\nFailure [INSTALL_FAILED_INSUFFICIENT_STORAGE]\n", 0);

    const error = (await installAndroidApp(target, "/out/app.apk").catch((e: unknown) => e)) as InstanceType<
      typeof ProcessFailure
    >;

    expect(error).toBeInstanceOf(ProcessFailure);
    expect(error.diagnosis.errors).toEqual(["INSTALL_FAILED_INSUFFICIENT_STORAGE"]);
    expect(error.diagnosis.hints[0]).toMatch(/out of storage/);
  });

  it("explains a device that went offline", async () => {
    adbResponds("adb: error: device offline\n", 1);

    const error = (await installAndroidApp(target, "/out/app.apk").catch((e: unknown) => e)) as InstanceType<
      typeof ProcessFailure
    >;

    expect(error.diagnosis.hints[0]).toMatch(/went offline/);
  });
});

describe("launchAndroidApp", () => {
  it("starts the app's MainActivity", async () => {
    adbResponds("Starting: Intent { cmp=dev.wefter.demo/dev.wefter.MainActivity }\n");

    await launchAndroidApp(target);

    expect(spawnMock).toHaveBeenCalledWith(
      "adb",
      ["-s", "R58N12ABC", "shell", "am", "start", "-n", "dev.wefter.demo/dev.wefter.MainActivity"],
      expect.any(Object),
    );
  });

  it("fails when am start reports an error, although it exits 0", async () => {
    adbResponds(
      "Starting: Intent { cmp=dev.wefter.demo/dev.wefter.MainActivity }\nError type 3\nError: Activity class {dev.wefter.demo/dev.wefter.MainActivity} does not exist.\n",
      0,
    );

    const error = (await launchAndroidApp(target).catch((e: unknown) => e)) as InstanceType<typeof ProcessFailure>;

    expect(error).toBeInstanceOf(ProcessFailure);
    expect(error.diagnosis.hints[0]).toMatch(/wefter sync/);
  });
});

describe("restartAndroidApp", () => {
  it("force-stops the app, then starts it again", async () => {
    adbResponds("");
    adbResponds("Starting: Intent { cmp=dev.wefter.demo/dev.wefter.MainActivity }\n");

    await restartAndroidApp(target);

    expect(spawnMock.mock.calls.map(([, args]) => (args as string[]).slice(2).join(" "))).toEqual([
      "shell am force-stop dev.wefter.demo",
      "shell am start -n dev.wefter.demo/dev.wefter.MainActivity",
    ]);
  });
});
