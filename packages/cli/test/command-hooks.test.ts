import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { iosAppDir } from "../src/config/project-paths.js";

const runHookMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/hooks/run-hook.js", () => ({
  runHook: (...args: unknown[]) => runHookMock(...args),
}));

const buildAndroidMock = vi.fn().mockResolvedValue({ apkPath: "/out/app.apk", sizeBytes: 123 });
vi.mock("../src/native/android-builder.js", () => ({
  buildAndroid: (...args: unknown[]) => buildAndroidMock(...args),
}));

const buildIosMock = vi.fn().mockResolvedValue({ appPath: "/out/App.app", sizeBytes: 456 });
vi.mock("../src/native/ios-builder.js", () => ({
  buildIos: (...args: unknown[]) => buildIosMock(...args),
}));

const resolveSimulatorMock = vi.fn().mockResolvedValue("iPhone 15");
const installAndLaunchIosMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/native/ios-run.js", () => ({
  resolveSimulator: (...args: unknown[]) => resolveSimulatorMock(...args),
  installAndLaunchIos: (...args: unknown[]) => installAndLaunchIosMock(...args),
}));

const spawnMock = vi.fn((cmd: string, args: string[] = []) => {
  const emitter = new EventEmitter() as EventEmitter & { stdout?: EventEmitter; stderr?: EventEmitter };
  if (cmd === "adb" && args[0] === "devices") {
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    queueMicrotask(() => {
      emitter.stdout!.emit("data", Buffer.from("List of devices attached\nemulator-5554\tdevice\n"));
      emitter.emit("exit", 0);
    });
    return emitter;
  }
  queueMicrotask(() => emitter.emit("exit", 0));
  return emitter;
});
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixtureTestProjectDir = join(fixturesDir, "test-project");

let projectDir: string;

beforeEach(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-cmdhooks-"));
  cpSync(join(fixtureTestProjectDir, "plugins"), join(projectDir, "plugins"), { recursive: true });
  cpSync(join(fixtureTestProjectDir, "wefter.config.json"), join(projectDir, "wefter.config.json"));
  cpSync(join(fixtureTestProjectDir, "web"), join(projectDir, "web"), { recursive: true });

  const appDir = iosAppDir(projectDir);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "Info.plist"),
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<!-- WEFTER-PERMISSIONS-START -->\n\t<!-- WEFTER-PERMISSIONS-END -->\n</dict>\n</plist>\n',
  );

  const { writeSyncMarker } = await import("../src/plugins/sync-freshness.js");
  writeSyncMarker(projectDir);

  runHookMock.mockReset().mockResolvedValue(undefined);
  buildAndroidMock.mockReset().mockResolvedValue({ apkPath: "/out/app.apk", sizeBytes: 123 });
  buildIosMock.mockReset().mockResolvedValue({ appPath: "/out/App.app", sizeBytes: 456 });
  resolveSimulatorMock.mockReset().mockResolvedValue("iPhone 15");
  installAndLaunchIosMock.mockReset().mockResolvedValue(undefined);
  spawnMock.mockClear();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("build() hook wiring", () => {
  it("fires wefter:build:before then wefter:build:after around a successful build, in order", async () => {
    const { build } = await import("../src/commands/build.js");
    const order: string[] = [];
    runHookMock.mockImplementation(async (_dir, command, phase) => {
      order.push(`${command}:${phase}`);
    });
    buildAndroidMock.mockImplementationOnce(async () => {
      order.push("buildAndroid");
      return { apkPath: "/out/app.apk", sizeBytes: 1 };
    });

    await build(projectDir, { release: false, env: "production" });

    expect(order).toEqual(["build:before", "buildAndroid", "build:after"]);
    expect(runHookMock).toHaveBeenCalledWith(
      projectDir,
      "build",
      "before",
      { platform: "android", environment: "production" },
    );
    expect(runHookMock).toHaveBeenCalledWith(
      projectDir,
      "build",
      "after",
      { platform: "android", environment: "production" },
    );
  });

  it("aborts before the real build starts if wefter:build:before fails", async () => {
    runHookMock.mockImplementation(async (_dir, _command, phase) => {
      if (phase === "before") throw new Error('Hook "wefter:build:before" exited with code 1');
    });
    const { build } = await import("../src/commands/build.js");

    await expect(build(projectDir, { release: false, env: "development" })).rejects.toThrow(
      'Hook "wefter:build:before" exited with code 1',
    );
    expect(buildAndroidMock).not.toHaveBeenCalled();
  });

  it("does not fire wefter:build:after if the build itself fails", async () => {
    buildAndroidMock.mockRejectedValueOnce(new Error("Gradle build failed with exit code 1"));
    const { build } = await import("../src/commands/build.js");

    await expect(build(projectDir, { release: false, env: "development" })).rejects.toThrow(
      "Gradle build failed",
    );
    expect(runHookMock).toHaveBeenCalledWith(projectDir, "build", "before", expect.anything());
    expect(runHookMock).not.toHaveBeenCalledWith(projectDir, "build", "after", expect.anything());
  });

  it("fires iOS build hooks with platform: ios", async () => {
    const { buildIosCommand } = await import("../src/commands/build.js");

    await buildIosCommand(projectDir, { release: false, env: "development" });

    expect(runHookMock).toHaveBeenCalledWith(
      projectDir,
      "build",
      "before",
      { platform: "ios", environment: "development" },
    );
    expect(runHookMock).toHaveBeenCalledWith(
      projectDir,
      "build",
      "after",
      { platform: "ios", environment: "development" },
    );
  });

  it("does not fire the iOS wefter:build:after if buildIos fails", async () => {
    buildIosMock.mockRejectedValueOnce(new Error("xcodebuild failed"));
    const { buildIosCommand } = await import("../src/commands/build.js");

    await expect(buildIosCommand(projectDir, { release: false, env: "development" })).rejects.toThrow(
      "xcodebuild failed",
    );
    expect(runHookMock).not.toHaveBeenCalledWith(projectDir, "build", "after", expect.anything());
  });
});

describe("run() hook wiring", () => {
  it("fires wefter:run:before then wefter:run:after around a successful android run, once, not per hot-reload", async () => {
    const { run } = await import("../src/commands/run.js");
    const order: string[] = [];
    runHookMock.mockImplementation(async (_dir, command, phase) => {
      order.push(`${command}:${phase}`);
    });

    await run(projectDir, { watch: false, env: "development" });

    expect(order).toEqual(["run:before", "run:after"]);
    expect(runHookMock).toHaveBeenCalledTimes(2);
  });

  it("aborts before install/launch if wefter:run:before fails", async () => {
    runHookMock.mockImplementation(async (_dir, _command, phase) => {
      if (phase === "before") throw new Error('Hook "wefter:run:before" exited with code 1');
    });
    const { run } = await import("../src/commands/run.js");

    await expect(run(projectDir, { watch: false, env: "development" })).rejects.toThrow(
      'Hook "wefter:run:before" exited with code 1',
    );
    expect(spawnMock).not.toHaveBeenCalledWith("adb", expect.arrayContaining(["install"]));
  });

  it("fires iOS run hooks with platform: ios and does not fire after on install failure", async () => {
    installAndLaunchIosMock.mockRejectedValueOnce(new Error("install failed"));
    const { runIos } = await import("../src/commands/run.js");

    await expect(runIos(projectDir, { watch: false, env: "development" })).rejects.toThrow("install failed");

    expect(runHookMock).toHaveBeenCalledWith(
      projectDir,
      "run",
      "before",
      { platform: "ios", environment: "development" },
    );
    expect(runHookMock).not.toHaveBeenCalledWith(projectDir, "run", "after", expect.anything());
  });
});
