import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WefterConfig } from "../src/config/wefter-config-schema.js";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

function fakeSpawn(exitCode: number) {
  const emitter = new EventEmitter() as EventEmitter & { on: EventEmitter["on"] };
  spawnMock.mockReturnValueOnce(emitter);
  queueMicrotask(() => emitter.emit("exit", exitCode));
  return emitter;
}

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  spawnMock.mockReset();
});

const baseConfig: WefterConfig = {
  plugins: [],
  pluginsDir: "node_modules",
  webDir: "dist",
  environments: { production: { appId: "com.example.app", appName: "Example" } },
};

describe("buildIos", () => {
  it("invokes xcodebuild with -project, -scheme WefterBridge, and a Debug-<Env> configuration", async () => {
    const { buildIos } = await import("../src/native/ios-builder.js");
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-build-"));
    const productsDir = join(dir, ".wefter/native/ios/build/Build/Products/Debug-Development-iphonesimulator");
    mkdirSync(join(productsDir, "WefterBridge.app"), { recursive: true });
    writeFileSync(join(productsDir, "WefterBridge.app", "WefterBridge"), "fake binary");

    fakeSpawn(0);

    await buildIos(dir, baseConfig, "development", false);

    expect(spawnMock).toHaveBeenCalledWith(
      "xcodebuild",
      expect.arrayContaining(["-project", expect.stringContaining("WefterBridge.xcodeproj"), "-scheme", "WefterBridge", "-configuration", "Debug-Development"]),
      expect.any(Object),
    );
  });

  it("uses a Release-<Env> configuration for a release build", async () => {
    const { buildIos } = await import("../src/native/ios-builder.js");
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-build-"));
    const productsDir = join(dir, ".wefter/native/ios/build/Build/Products/Release-Production-iphonesimulator");
    mkdirSync(join(productsDir, "WefterBridge.app"), { recursive: true });
    writeFileSync(join(productsDir, "WefterBridge.app", "WefterBridge"), "fake binary");

    fakeSpawn(0);

    await buildIos(dir, baseConfig, "production", true);

    expect(spawnMock).toHaveBeenCalledWith(
      "xcodebuild",
      expect.arrayContaining(["-configuration", "Release-Production"]),
      expect.any(Object),
    );
  });

  it("appends signing build settings only for a release build with iosSigning configured", async () => {
    const { buildIos } = await import("../src/native/ios-builder.js");
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-build-"));
    const productsDir = join(dir, ".wefter/native/ios/build/Build/Products/Release-Production-iphonesimulator");
    mkdirSync(join(productsDir, "WefterBridge.app"), { recursive: true });
    writeFileSync(join(productsDir, "WefterBridge.app", "WefterBridge"), "fake binary");

    fakeSpawn(0);

    const signedConfig: WefterConfig = { ...baseConfig, iosSigning: { teamId: "ABCDE12345" } };
    await buildIos(dir, signedConfig, "production", true);

    expect(spawnMock).toHaveBeenCalledWith(
      "xcodebuild",
      expect.arrayContaining(["DEVELOPMENT_TEAM=ABCDE12345"]),
      expect.any(Object),
    );
  });

  it("resolves with the built .app path and its total size once xcodebuild exits 0", async () => {
    const { buildIos } = await import("../src/native/ios-builder.js");
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-build-"));
    const productsDir = join(dir, ".wefter/native/ios/build/Build/Products/Debug-Development-iphonesimulator");
    const appDir = join(productsDir, "WefterBridge.app");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, "WefterBridge"), "fake binary contents");

    fakeSpawn(0);

    const result = await buildIos(dir, baseConfig, "development", false);

    expect(result.appPath).toBe(appDir);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("rejects with a clear error when xcodebuild exits non-zero", async () => {
    const { buildIos } = await import("../src/native/ios-builder.js");
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-build-"));

    fakeSpawn(65);

    await expect(buildIos(dir, baseConfig, "development", false)).rejects.toThrow(/exit code 65/);
  });

  it("rejects clearly when the build reports success but no .app bundle is found", async () => {
    const { buildIos } = await import("../src/native/ios-builder.js");
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-build-"));
    const productsDir = join(dir, ".wefter/native/ios/build/Build/Products/Debug-Development-iphonesimulator");
    mkdirSync(productsDir, { recursive: true }); 

    fakeSpawn(0);

    await expect(buildIos(dir, baseConfig, "development", false)).rejects.toThrow(/No \.app bundle found/);
  });

  it("passes a specific simulator destination when one is given, generic otherwise", async () => {
    const { buildIos } = await import("../src/native/ios-builder.js");
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-build-"));
    const productsDir = join(dir, ".wefter/native/ios/build/Build/Products/Debug-Development-iphonesimulator");
    mkdirSync(join(productsDir, "WefterBridge.app"), { recursive: true });
    writeFileSync(join(productsDir, "WefterBridge.app", "WefterBridge"), "x");

    fakeSpawn(0);
    await buildIos(dir, baseConfig, "development", false, { simulator: "iPhone 16" });

    expect(spawnMock).toHaveBeenCalledWith(
      "xcodebuild",
      expect.arrayContaining(["-destination", "platform=iOS Simulator,name=iPhone 16"]),
      expect.any(Object),
    );
  });
});
