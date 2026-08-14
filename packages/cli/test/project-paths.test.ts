import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  iosAppDir,
  iosBuildConfigPath,
  iosBundleId,
  iosConfigDir,
  iosGeneratedRegistryPath,
  iosInfoPlistPath,
  iosNativeDependenciesPackagePath,
  iosPluginSourceDir,
  iosProjectRootDir,
  iosWebAssetsDir,
  iosXcconfigPath,
  iosXcodeProjectPath,
  loadWefterConfig,
} from "../src/config/project-paths.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), "wefter-ios-paths-"));
}

describe("iOS path helpers — not ejected", () => {
  it("nests everything under .wefter/native/ios, mirroring .wefter/native/android", () => {
    dir = makeProjectDir();

    expect(iosProjectRootDir(dir)).toBe(join(dir, ".wefter/native/ios"));
    expect(iosAppDir(dir)).toBe(join(dir, ".wefter/native/ios/WefterBridge"));
    expect(iosXcodeProjectPath(dir)).toBe(join(dir, ".wefter/native/ios/WefterBridge.xcodeproj"));
    expect(iosConfigDir(dir)).toBe(join(dir, ".wefter/native/ios/Config"));
  });

  it("derives every file path from iosAppDir consistently", () => {
    dir = makeProjectDir();

    expect(iosGeneratedRegistryPath(dir)).toBe(join(iosAppDir(dir), "GeneratedRegistry.swift"));
    expect(iosPluginSourceDir(dir)).toBe(join(iosAppDir(dir), "Plugins"));
    expect(iosInfoPlistPath(dir)).toBe(join(iosAppDir(dir), "Info.plist"));
    expect(iosWebAssetsDir(dir)).toBe(join(iosAppDir(dir), "www"));
    expect(iosBuildConfigPath(dir)).toBe(join(iosAppDir(dir), "BuildConfig.swift"));
  });

  it("builds an xcconfig path from a bare name", () => {
    dir = makeProjectDir();

    expect(iosXcconfigPath(dir, "Debug-Development")).toBe(join(iosConfigDir(dir), "Debug-Development.xcconfig"));
  });

  it("points NativeDependencies/Package.swift at the project root, not under WefterBridge/", () => {
    dir = makeProjectDir();

    expect(iosNativeDependenciesPackagePath(dir)).toBe(
      join(iosProjectRootDir(dir), "NativeDependencies/Package.swift"),
    );
  });
});

describe("iOS path helpers — ejected", () => {
  it("redirects to <project>/ios once the project has ejected, exactly like Android redirects to <project>/android", () => {
    dir = makeProjectDir();
    writeFileSync(join(dir, ".wefter-ejected"), "true\n");

    expect(iosProjectRootDir(dir)).toBe(join(dir, "ios"));
    expect(iosAppDir(dir)).toBe(join(dir, "ios/WefterBridge"));
  });
});

describe("iosBundleId", () => {
  it("falls back to the environment's appId when no iosBundleId override is set", () => {
    dir = makeProjectDir();
    writeFileSync(
      join(dir, "wefter.config.json"),
      JSON.stringify({ environments: { production: { appId: "com.example.app", appName: "Example" } } }),
    );
    const config = loadWefterConfig(dir);

    expect(iosBundleId(config, "production")).toBe("com.example.app");
  });

  it("prefers an explicit iosBundleId override over appId", () => {
    dir = makeProjectDir();
    writeFileSync(
      join(dir, "wefter.config.json"),
      JSON.stringify({
        environments: {
          production: { appId: "com.example.app", appName: "Example", iosBundleId: "com.example.ios" },
        },
      }),
    );
    const config = loadWefterConfig(dir);

    expect(iosBundleId(config, "production")).toBe("com.example.ios");
  });

  it("throws naming the unknown environment", () => {
    dir = makeProjectDir();
    writeFileSync(
      join(dir, "wefter.config.json"),
      JSON.stringify({ environments: { production: { appId: "com.example.app", appName: "Example" } } }),
    );
    const config = loadWefterConfig(dir);

    expect(() => iosBundleId(config, "staging")).toThrow(/staging/);
  });
});
