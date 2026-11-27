import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

vi.mock("../src/hooks/run-hook.js", () => ({ runHook: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/devserver/lan-ip.js", () => ({ resolveLanIp: vi.fn().mockResolvedValue("10.0.0.2") }));
vi.mock("../src/utils/transactional-sync.js", () => ({
  runTransactionalSync: async (_files: string[], fn: () => unknown) => fn(),
}));

const buildAndroidMock = vi.fn();
vi.mock("../src/native/android-builder.js", () => ({
  buildAndroid: (...args: unknown[]) => buildAndroidMock(...args),
}));
vi.mock("../src/native/adb-device.js", () => ({
  resolveAdbDevice: vi.fn().mockResolvedValue({ serial: "emulator-5554", state: "device", model: "Pixel_8" }),
  reverseAdbPort: vi.fn().mockResolvedValue(true),
}));
const restartAndroidAppMock = vi.fn();
vi.mock("../src/native/android-run.js", () => ({
  installAndroidApp: vi.fn().mockResolvedValue(undefined),
  launchAndroidApp: vi.fn().mockResolvedValue(undefined),
  restartAndroidApp: (...args: unknown[]) => restartAndroidAppMock(...args),
}));

const buildIosMock = vi.fn();
vi.mock("../src/native/ios-builder.js", () => ({ buildIos: (...args: unknown[]) => buildIosMock(...args) }));
const restartIosAppMock = vi.fn();
vi.mock("../src/native/ios-run.js", () => ({
  resolveSimulator: vi.fn().mockResolvedValue({ udid: "SIM-1", name: "iPhone 17", state: "Booted" }),
  bootSimulator: vi.fn().mockResolvedValue(true),
  installIosApp: vi.fn().mockResolvedValue(undefined),
  launchIosApp: vi.fn().mockResolvedValue(undefined),
  restartIosApp: (...args: unknown[]) => restartIosAppMock(...args),
}));
vi.mock("../src/native/check-info-plist-permissions.js", () => ({
  checkInfoPlistPermissionKeys: () => ({ passed: true, issues: [] }),
}));

const injectDevServerUrlMock = vi.fn();
const injectDevServerUrlIosMock = vi.fn();
vi.mock("../src/native/inject-dev-server.js", () => ({
  injectDevServerUrl: (...args: unknown[]) => injectDevServerUrlMock(...args),
  injectNetworkSecurityException: vi.fn(),
}));
vi.mock("../src/native/inject-dev-server-ios.js", () => ({
  injectDevServerUrlIos: (...args: unknown[]) => injectDevServerUrlIosMock(...args),
  injectNetworkSecurityExceptionIos: vi.fn(),
}));

const devServer = {
  url: "http://10.0.0.2:5173",
  devtoolsUrl: Promise.resolve(null),
  process: new EventEmitter(),
  stop: vi.fn(),
  onExit: vi.fn(),
};
const startDevServerMock = vi.fn();
vi.mock("../src/devserver/vite-launcher.js", () => ({
  startDevServer: (...args: unknown[]) => startDevServerMock(...args),
}));

const { runAll } = await import("../src/commands/run.js");
const { writeSyncMarker } = await import("../src/plugins/sync-freshness.js");
const { configureUi, setTerminalStreams, stripAnsi } = await import("../src/ui/terminal.js");

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/test-project");
let projectDir: string;
let out: string;
const onPlatformFailure = vi.fn();

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-run-all-"));
  cpSync(join(fixtureDir, "plugins"), join(projectDir, "plugins"), { recursive: true });
  cpSync(join(fixtureDir, "wefter.config.json"), join(projectDir, "wefter.config.json"));
  writeSyncMarker(projectDir);

  out = "";
  setTerminalStreams({ out: (c) => (out += c), err: (c) => (out += c), columns: () => 120 });
  configureUi({ debug: false, interactive: false, unicode: true });

  buildAndroidMock.mockReset().mockResolvedValue({ apkPath: "/out/app.apk" });
  buildIosMock.mockReset().mockResolvedValue({ appPath: "/out/App.app" });
  restartAndroidAppMock.mockReset().mockResolvedValue(undefined);
  restartIosAppMock.mockReset().mockResolvedValue(undefined);
  injectDevServerUrlMock.mockReset();
  injectDevServerUrlIosMock.mockReset();
  startDevServerMock.mockReset().mockResolvedValue(devServer);
  devServer.stop.mockReset();
  onPlatformFailure.mockReset();
});

afterEach(() => {
  setTerminalStreams(null);
  rmSync(projectDir, { recursive: true, force: true });
});

const options = { watch: true, env: "development", onPlatformFailure, hostPlatform: "darwin" as const };

describe("runAll", () => {
  it("runs Android and then iOS with one dev server, both on localhost", async () => {
    const session = await runAll(projectDir, options);

    expect(startDevServerMock).toHaveBeenCalledTimes(1);
    expect(injectDevServerUrlMock).toHaveBeenCalledWith(expect.any(String), "http://localhost:5173");
    expect(injectDevServerUrlIosMock).toHaveBeenCalledWith(expect.any(String), "http://localhost:5173");
    expect(buildAndroidMock.mock.invocationCallOrder[0]).toBeLessThan(buildIosMock.mock.invocationCallOrder[0]);
    expect(session).toMatchObject({
      platform: "all",
      appName: "Example (Dev)",
      targetName: "Pixel 8 (emulator-5554) and iPhone 17",
      devServer,
    });
    expect(onPlatformFailure).not.toHaveBeenCalled();
    const text = stripAnsi(out);
    expect(text.indexOf("Android")).toBeLessThan(text.indexOf("iOS"));
    expect(text).toMatch(/✔ Building iOS app \(development\)/);
  });

  it("without --watch, starts no dev server", async () => {
    const session = await runAll(projectDir, { ...options, watch: false });

    expect(startDevServerMock).not.toHaveBeenCalled();
    expect(session?.devServer).toBeNull();
    expect(session?.targetName).toBe("Pixel 8 (emulator-5554) and iPhone 17");
  });

  it("keeps iOS running when Android fails, and retries Android on rebuild", async () => {
    const gradleError = new Error("Gradle build failed with exit code 1");
    buildAndroidMock.mockRejectedValueOnce(gradleError);

    const session = await runAll(projectDir, options);

    expect(onPlatformFailure).toHaveBeenCalledWith("android", gradleError);
    expect(devServer.stop).not.toHaveBeenCalled();
    expect(session?.targetName).toBe("iPhone 17");

    await session!.rebuild();

    expect(buildAndroidMock).toHaveBeenCalledTimes(2);
    expect(buildIosMock).toHaveBeenCalledTimes(2);
    expect(session?.targetName).toBe("Pixel 8 (emulator-5554) and iPhone 17");
  });

  it("rebuild() tries every platform, reports all failures but the last and throws the last", async () => {
    const session = await runAll(projectDir, options);
    const androidError = new Error("Gradle build failed");
    const iosError = new Error("xcodebuild failed");
    buildAndroidMock.mockRejectedValueOnce(androidError);
    buildIosMock.mockRejectedValueOnce(iosError);

    await expect(session!.rebuild()).rejects.toBe(iosError);
    expect(onPlatformFailure).toHaveBeenCalledTimes(1);
    expect(onPlatformFailure).toHaveBeenCalledWith("android", androidError);
  });

  it("returns null and stops the dev server when neither platform runs", async () => {
    buildAndroidMock.mockRejectedValueOnce(new Error("Gradle build failed"));
    buildIosMock.mockRejectedValueOnce(new Error("xcodebuild failed"));

    await expect(runAll(projectDir, options)).resolves.toBeNull();
    expect(onPlatformFailure.mock.calls.map(([platform]) => platform)).toEqual(["android", "ios"]);
    expect(devServer.stop).toHaveBeenCalledTimes(1);
  });

  it("runs only Android on computers other than Macs", async () => {
    const session = await runAll(projectDir, { ...options, hostPlatform: "linux" });

    expect(buildIosMock).not.toHaveBeenCalled();
    expect(session?.targetName).toBe("Pixel 8 (emulator-5554)");
  });

  it("restartApp() restarts both apps", async () => {
    const session = await runAll(projectDir, options);

    await session!.restartApp();

    expect(restartAndroidAppMock).toHaveBeenCalledTimes(1);
    expect(restartIosAppMock).toHaveBeenCalledWith("com.example.app.dev", "SIM-1");
  });

  it("rejects an unknown environment before starting anything", async () => {
    await expect(runAll(projectDir, { ...options, env: "staging" })).rejects.toThrow(/Unknown environment/);
    expect(startDevServerMock).not.toHaveBeenCalled();
  });
});
