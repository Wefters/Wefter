import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectSplashConfigIos } from "../src/native/inject-splash-config-ios.js";
import { iosShellTemplatePath } from "../src/native/shell-template.js";

const BUILD_CONFIG_FIXTURE = `enum BuildConfig {
    #if DEBUG
    static let devServerURL = "" // WEFTER overridden per-run by the CLI
    #else
    static let devServerURL = "" // WEFTER always empty in release — never shippable
    #endif

    // WEFTER-SPLASH-CONFIG-START
    static let splashEnabled = false
    static let splashMinDurationMs: Double = 600
    static let splashFadeOutMs: Double = 300
    // WEFTER-SPLASH-CONFIG-END
}
`;

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("injectSplashConfigIos", () => {
  it("rewrites all three splash values between the markers", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-splash-"));
    const buildConfigPath = join(dir, "BuildConfig.swift");
    writeFileSync(buildConfigPath, BUILD_CONFIG_FIXTURE);

    injectSplashConfigIos(buildConfigPath, { enabled: true, minDurationMs: 800, fadeOutDurationMs: 250 });

    const result = readFileSync(buildConfigPath, "utf-8");
    expect(result).toContain("static let splashEnabled = true");
    expect(result).toContain("static let splashMinDurationMs: Double = 800");
    expect(result).toContain("static let splashFadeOutMs: Double = 250");
  });

  it("leaves DEV_SERVER_URL untouched", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-splash-"));
    const buildConfigPath = join(dir, "BuildConfig.swift");
    writeFileSync(buildConfigPath, BUILD_CONFIG_FIXTURE);

    injectSplashConfigIos(buildConfigPath, { enabled: true, minDurationMs: 800, fadeOutDurationMs: 250 });

    const result = readFileSync(buildConfigPath, "utf-8");
    expect(result).toContain('static let devServerURL = "" // WEFTER overridden per-run by the CLI');
  });

  it("replaces the existing values on a second run instead of duplicating the marker block", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-splash-"));
    const buildConfigPath = join(dir, "BuildConfig.swift");
    writeFileSync(buildConfigPath, BUILD_CONFIG_FIXTURE);

    injectSplashConfigIos(buildConfigPath, { enabled: true, minDurationMs: 800, fadeOutDurationMs: 250 });
    injectSplashConfigIos(buildConfigPath, { enabled: false, minDurationMs: 600, fadeOutDurationMs: 300 });

    const result = readFileSync(buildConfigPath, "utf-8");
    const markerCount = result.split("// WEFTER-SPLASH-CONFIG-START").length - 1;
    expect(markerCount).toBe(1);
    expect(result).toContain("static let splashEnabled = false");
  });

  it("throws clearly when the marker is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-splash-"));
    const buildConfigPath = join(dir, "BuildConfig.swift");
    writeFileSync(buildConfigPath, "enum BuildConfig {}\n");

    expect(() =>
      injectSplashConfigIos(buildConfigPath, { enabled: true, minDurationMs: 800, fadeOutDurationMs: 250 }),
    ).toThrow(/WEFTER-SPLASH-CONFIG-START/);
  });
});

describe("injectSplashConfigIos against the real shell template", () => {
  it("rewrites the real shells/ios-template/WefterBridge/BuildConfig.swift", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-splash-real-"));
    const buildConfigPath = join(dir, "BuildConfig.swift");
    cpSync(join(iosShellTemplatePath(), "WefterBridge/BuildConfig.swift"), buildConfigPath);

    injectSplashConfigIos(buildConfigPath, { enabled: true, minDurationMs: 800, fadeOutDurationMs: 250 });

    const result = readFileSync(buildConfigPath, "utf-8");
    expect(result).toContain("static let splashEnabled = true");
  });
});
