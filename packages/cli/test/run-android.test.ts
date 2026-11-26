import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

vi.mock("../src/hooks/run-hook.js", () => ({ runHook: vi.fn().mockResolvedValue(undefined) }));

const buildAndroidMock = vi.fn();
vi.mock("../src/native/android-builder.js", () => ({
  buildAndroid: (...args: unknown[]) => buildAndroidMock(...args),
}));

vi.mock("../src/native/adb-device.js", () => ({
  resolveAdbDevice: vi.fn().mockResolvedValue({ serial: "emulator-5554", state: "device", model: "Pixel_8" }),
}));

vi.mock("../src/devserver/lan-ip.js", () => ({ resolveLanIp: vi.fn().mockResolvedValue("10.0.0.2") }));

const devServer = {
  url: "http://10.0.0.2:5173",
  devtoolsUrl: Promise.resolve("http://10.0.0.2:5173/__wefter-devtools"),
  process: new EventEmitter(),
  stop: vi.fn(),
  onExit: vi.fn(),
};
const startDevServerMock = vi.fn();
vi.mock("../src/devserver/vite-launcher.js", () => ({
  startDevServer: (...args: unknown[]) => startDevServerMock(...args),
}));

const injectDevServerUrlMock = vi.fn();
const injectNetworkSecurityExceptionMock = vi.fn();
vi.mock("../src/native/inject-dev-server.js", () => ({
  injectDevServerUrl: (...args: unknown[]) => injectDevServerUrlMock(...args),
  injectNetworkSecurityException: (...args: unknown[]) => injectNetworkSecurityExceptionMock(...args),
}));

vi.mock("../src/utils/transactional-sync.js", () => ({
  runTransactionalSync: async (_files: string[], fn: () => unknown) => fn(),
}));

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { run } = await import("../src/commands/run.js");
const { writeSyncMarker } = await import("../src/plugins/sync-freshness.js");
const { configureUi, setTerminalStreams, stripAnsi } = await import("../src/ui/terminal.js");

/** Every adb call succeeds and prints what adb prints on success. */
function adbSucceeds() {
  spawnMock.mockImplementation((_cmd: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    queueMicrotask(() => {
      const output = args.includes("install") ? "Performing Streamed Install\nSuccess\n" : "Starting: Intent\n";
      child.stdout.emit("data", Buffer.from(output));
      child.emit("exit", 0);
      child.emit("close", 0);
    });
    return child;
  });
}

const adbCalls = () => spawnMock.mock.calls.map(([, args]) => (args as string[]).join(" "));

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/test-project");
let projectDir: string;
let out: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-run-android-"));
  cpSync(join(fixtureDir, "plugins"), join(projectDir, "plugins"), { recursive: true });
  cpSync(join(fixtureDir, "wefter.config.json"), join(projectDir, "wefter.config.json"));
  writeSyncMarker(projectDir);

  out = "";
  setTerminalStreams({ out: (c) => (out += c), err: (c) => (out += c), columns: () => 120 });
  configureUi({ debug: false, interactive: false, unicode: true });

  buildAndroidMock.mockReset().mockImplementation(async (_dir, _config, _env, _release, options) => {
    options?.onProgress?.("Compiling Kotlin · 4 tasks");
    return { apkPath: "/out/app-development-debug.apk", sizeBytes: 8_400_000 };
  });
  startDevServerMock.mockReset().mockResolvedValue(devServer);
  devServer.stop.mockReset();
  injectDevServerUrlMock.mockReset();
  injectNetworkSecurityExceptionMock.mockReset();
  spawnMock.mockReset();
  adbSucceeds();
});

afterEach(() => {
  setTerminalStreams(null);
  rmSync(projectDir, { recursive: true, force: true });
});

describe("run (Android)", () => {
  it("builds, installs and launches on the chosen device, reporting each step", async () => {
    const session = await run(projectDir, { watch: false, env: "development" });

    expect(buildAndroidMock).toHaveBeenCalledWith(
      projectDir,
      expect.objectContaining({ pluginsDir: "plugins" }),
      "development",
      false,
      { onProgress: expect.any(Function) },
    );
    expect(adbCalls()).toEqual([
      "-s emulator-5554 install -r /out/app-development-debug.apk",
      "-s emulator-5554 shell am start -n com.example.app.dev/com.example.app.MainActivity",
    ]);
    const text = stripAnsi(out);
    expect(text).toMatch(/✔ Building Android app \(development\)/);
    expect(text).toMatch(/✔ Installing on Pixel 8 \(emulator-5554\)/);
    expect(text).toMatch(/✔ Launching app/);
    expect(session).toMatchObject({
      platform: "android",
      appName: "Example (Dev)",
      targetName: "Pixel 8 (emulator-5554)",
      devServer: null,
      devtoolsUrl: null,
    });
    expect(session.buildMs).toBeGreaterThanOrEqual(0);
  });

  it("with --watch, starts the dev server and points the app at it before building", async () => {
    const session = await run(projectDir, { watch: true, env: "development" });

    expect(startDevServerMock).toHaveBeenCalledWith(projectDir, "10.0.0.2");
    expect(injectNetworkSecurityExceptionMock).toHaveBeenCalledWith(expect.any(String), "10.0.0.2");
    expect(injectDevServerUrlMock).toHaveBeenCalledWith(expect.stringMatching(/build\.gradle/), devServer.url);
    expect(session.devServer).toBe(devServer);
    expect(session.devtoolsUrl).toBe("http://10.0.0.2:5173/__wefter-devtools");
    expect(stripAnsi(out)).toContain("✔ Dev server ready at http://10.0.0.2:5173");
  });

  it("stops the dev server if anything fails after it started", async () => {
    buildAndroidMock.mockRejectedValueOnce(new Error("Gradle build failed with exit code 1"));

    await expect(run(projectDir, { watch: true, env: "development" })).rejects.toThrow("Gradle build failed");
    expect(devServer.stop).toHaveBeenCalledTimes(1);
    expect(stripAnsi(out)).toMatch(/✖ Building Android app \(development\)/);
  });

  it("rebuild() builds, reinstalls and relaunches again", async () => {
    const session = await run(projectDir, { watch: false, env: "development" });
    spawnMock.mockClear();

    await session.rebuild();

    expect(buildAndroidMock).toHaveBeenCalledTimes(2);
    expect(adbCalls()).toEqual([
      "-s emulator-5554 install -r /out/app-development-debug.apk",
      "-s emulator-5554 shell am start -n com.example.app.dev/com.example.app.MainActivity",
    ]);
  });

  it("rebuild() refuses to build a project whose config changed since the last sync", async () => {
    const session = await run(projectDir, { watch: false, env: "development" });
    const configPath = join(projectDir, "wefter.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    writeFileSync(configPath, JSON.stringify({ ...config, plugins: [...config.plugins, "new-plugin"] }));

    await expect(session.rebuild()).rejects.toThrow(/wefter sync/);
    expect(buildAndroidMock).toHaveBeenCalledTimes(1);
  });

  it("restartApp() force-stops and relaunches without rebuilding", async () => {
    const session = await run(projectDir, { watch: false, env: "development" });
    spawnMock.mockClear();

    await session.restartApp();

    expect(adbCalls()).toEqual([
      "-s emulator-5554 shell am force-stop com.example.app.dev",
      "-s emulator-5554 shell am start -n com.example.app.dev/com.example.app.MainActivity",
    ]);
    expect(buildAndroidMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown environment before touching the device", async () => {
    await expect(run(projectDir, { watch: false, env: "staging" })).rejects.toThrow(/Unknown environment "staging"/);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
