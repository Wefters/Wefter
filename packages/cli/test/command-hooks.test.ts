import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { iosAppDir } from "../src/config/project-paths.js";

const runHookMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/hooks/run-hook.js", () => ({
  runHook: (...args: unknown[]) => runHookMock(...args),
}));

/** A fake built APK on disk, as Gradle would leave it. */
function fakeApk(): { apkPath: string; sizeBytes: number } {
  const apkPath = join(projectDir, "gradle-out", "Example-development-release.apk");
  mkdirSync(dirname(apkPath), { recursive: true });
  writeFileSync(apkPath, "apk");
  return { apkPath, sizeBytes: 3 };
}

/** A fake simulator app on disk, as xcodebuild would leave it. */
function fakeApp(): { appPath: string; sizeBytes: number } {
  const appPath = join(projectDir, "xcode-out", "Example.app");
  mkdirSync(appPath, { recursive: true });
  writeFileSync(join(appPath, "Example"), "binary");
  return { appPath, sizeBytes: 6 };
}

const buildAndroidMock = vi.fn(async () => fakeApk());
vi.mock("../src/native/android-builder.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/native/android-builder.js")>()),
  buildAndroid: (...args: unknown[]) => buildAndroidMock(...(args as [])),
}));

const buildIosMock = vi.fn(async () => fakeApp());
vi.mock("../src/native/ios-builder.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/native/ios-builder.js")>()),
  buildIos: (...args: unknown[]) => buildIosMock(...(args as [])),
}));

const syncMock = vi.fn(async () => ({ unresolvedRegisteredPlugins: [] }));
vi.mock("../src/commands/sync.js", () => ({
  sync: (...args: unknown[]) => syncMock(...(args as [])),
}));

vi.mock("../src/native/inject-version.js", () => ({
  injectVersionAndroid: vi.fn(),
  injectVersionIos: vi.fn(),
  versionBuildSettings: () => [],
}));

const BOOTED_SIMULATOR = { udid: "AAA-1", name: "iPhone 15", state: "Booted", isAvailable: true };
const resolveSimulatorMock = vi.fn().mockResolvedValue(BOOTED_SIMULATOR);
const installIosAppMock = vi.fn().mockResolvedValue(undefined);
const launchIosAppMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/native/ios-run.js", () => ({
  resolveSimulator: (...args: unknown[]) => resolveSimulatorMock(...args),
  bootSimulator: vi.fn().mockResolvedValue(false),
  installIosApp: (...args: unknown[]) => installIosAppMock(...args),
  launchIosApp: (...args: unknown[]) => launchIosAppMock(...args),
  restartIosApp: vi.fn().mockResolvedValue(undefined),
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
  buildAndroidMock.mockReset().mockImplementation(async () => fakeApk());
  buildIosMock.mockReset().mockImplementation(async () => fakeApp());
  syncMock.mockClear();
  resolveSimulatorMock.mockReset().mockResolvedValue(BOOTED_SIMULATOR);
  installIosAppMock.mockReset().mockResolvedValue(undefined);
  launchIosAppMock.mockReset().mockResolvedValue(undefined);
  spawnMock.mockClear();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("build() hook wiring", () => {
  it("runs before, sync, the build, then after, in order, with the build's details", async () => {
    const { build } = await import("../src/commands/build.js");
    const order: string[] = [];
    runHookMock.mockImplementation(async (_dir, command, phase) => {
      order.push(`${command}:${phase}`);
    });
    syncMock.mockImplementationOnce(async () => {
      order.push("sync");
      return { unresolvedRegisteredPlugins: [] };
    });
    buildAndroidMock.mockImplementationOnce(async () => {
      order.push("buildAndroid");
      return fakeApk();
    });

    const result = await build(projectDir, { release: false, env: "production", appVersion: "2.1.0", buildNumber: 9 });

    expect(order).toEqual(["build:before", "sync", "buildAndroid", "build:after"]);
    expect(runHookMock).toHaveBeenCalledWith(projectDir, "build", "before", {
      platform: "android",
      environment: "production",
      env: expect.objectContaining({ WEFTER_RELEASE: "false", WEFTER_APP_VERSION: "2.1.0", WEFTER_BUILD_NUMBER: "9" }),
    });
    expect(runHookMock).toHaveBeenCalledWith(projectDir, "build", "after", {
      platform: "android",
      environment: "production",
      env: expect.objectContaining({ WEFTER_ARTIFACT: result.primary.path, WEFTER_BUILD_INFO: result.buildInfoPath }),
    });
    expect(result.outputDir).toBe(join(projectDir, "build", "android", "production", "2.1.0-9"));
    expect(existsSync(result.primary.path)).toBe(true);
    expect(JSON.parse(readFileSync(result.buildInfoPath, "utf-8"))).toMatchObject({
      platform: "android",
      environment: "production",
      version: "2.1.0",
      buildNumber: 9,
    });
  });

  it("aborts before syncing or building if wefter:build:before fails, and runs wefter:build:failed", async () => {
    runHookMock.mockImplementation(async (_dir, _command, phase) => {
      if (phase === "before") throw new Error('Hook "wefter:build:before" exited with code 1');
    });
    const { build } = await import("../src/commands/build.js");

    await expect(build(projectDir, { release: false, env: "development" })).rejects.toThrow(
      'Hook "wefter:build:before" exited with code 1',
    );
    expect(syncMock).not.toHaveBeenCalled();
    expect(buildAndroidMock).not.toHaveBeenCalled();
    expect(runHookMock).toHaveBeenCalledWith(
      projectDir,
      "build",
      "failed",
      expect.objectContaining({
        env: expect.objectContaining({ WEFTER_ERROR: expect.stringContaining("exited with code 1") }),
      }),
    );
  });

  it("runs wefter:build:failed instead of after when the build itself fails", async () => {
    buildAndroidMock.mockRejectedValueOnce(new Error("Gradle build failed with exit code 1"));
    const { build } = await import("../src/commands/build.js");

    await expect(build(projectDir, { release: false, env: "development" })).rejects.toThrow("Gradle build failed");
    expect(runHookMock).toHaveBeenCalledWith(projectDir, "build", "before", expect.anything());
    expect(runHookMock).not.toHaveBeenCalledWith(projectDir, "build", "after", expect.anything());
    expect(runHookMock).toHaveBeenCalledWith(projectDir, "build", "failed", expect.anything());
  });

  it("stops when a hook starts another build, instead of looping", async () => {
    const { build } = await import("../src/commands/build.js");
    runHookMock.mockImplementation(async (_dir, _command, phase) => {
      if (phase === "before") await build(projectDir, { release: false, env: "development" });
    });

    await expect(build(projectDir, { release: false, env: "development" })).rejects.toThrow(/already running/);
    expect(process.env.WEFTER_BUILD_ACTIVE).toBeUndefined();
  });

  it("rejects an unknown environment, listing the configured ones, before any hook runs", async () => {
    const { build } = await import("../src/commands/build.js");

    await expect(build(projectDir, { release: false, env: "staging" })).rejects.toThrow(
      /Unknown environment "staging"\. Configured environments: development, production/,
    );
    expect(runHookMock).not.toHaveBeenCalled();
  });

  it("uses the production environment for a release unless --env is given", async () => {
    const { resolveBuildEnvironment } = await import("../src/commands/build.js");
    const { loadWefterConfig } = await import("../src/config/project-paths.js");
    const config = loadWefterConfig(projectDir);

    expect(resolveBuildEnvironment(config, { release: true })).toBe("production");
    expect(resolveBuildEnvironment(config, { release: false })).toBe("development");
    expect(resolveBuildEnvironment(config, { release: true, env: "development" })).toBe("development");
  });

  it("fails a release early when Android signing is missing, unless --unsigned", async () => {
    const { build } = await import("../src/commands/build.js");

    await expect(build(projectDir, { release: true })).rejects.toThrow(/Android release signing is not ready/);
    expect(runHookMock).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "darwin")("fires iOS build hooks with platform: ios", async () => {
    const { buildIosCommand } = await import("../src/commands/build.js");

    await buildIosCommand(projectDir, { release: false, env: "development" });

    expect(runHookMock).toHaveBeenCalledWith(
      projectDir,
      "build",
      "before",
      expect.objectContaining({ platform: "ios" }),
    );
    expect(runHookMock).toHaveBeenCalledWith(
      projectDir,
      "build",
      "after",
      expect.objectContaining({ platform: "ios" }),
    );
  });

  it.skipIf(process.platform !== "darwin")("does not fire the iOS wefter:build:after if buildIos fails", async () => {
    buildIosMock.mockRejectedValueOnce(new Error("xcodebuild failed"));
    const { buildIosCommand } = await import("../src/commands/build.js");

    await expect(buildIosCommand(projectDir, { release: false, env: "development" })).rejects.toThrow(
      "xcodebuild failed",
    );
    expect(runHookMock).not.toHaveBeenCalledWith(projectDir, "build", "after", expect.anything());
  });

  it.skipIf(process.platform !== "darwin")(
    "builds both platforms with one before hook and sync, and an after hook per platform",
    async () => {
      const { buildApp } = await import("../src/commands/build.js");
      const phases: string[] = [];
      runHookMock.mockImplementation(async (_dir, _command, phase, context) => {
        phases.push(`${phase}:${(context as { platform: string }).platform}`);
      });

      const results = await buildApp(projectDir, ["android", "ios"], { release: false });

      expect(results.map((r) => r.platform)).toEqual(["android", "ios"]);
      expect(syncMock).toHaveBeenCalledTimes(1);
      expect(phases).toEqual(["before:all", "after:android", "after:ios"]);
    },
  );
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
    installIosAppMock.mockRejectedValueOnce(new Error("install failed"));
    const { runIos } = await import("../src/commands/run.js");

    await expect(runIos(projectDir, { watch: false, env: "development" })).rejects.toThrow("install failed");

    expect(runHookMock).toHaveBeenCalledWith(projectDir, "run", "before", {
      platform: "ios",
      environment: "development",
    });
    expect(runHookMock).not.toHaveBeenCalledWith(projectDir, "run", "after", expect.anything());
  });
});
