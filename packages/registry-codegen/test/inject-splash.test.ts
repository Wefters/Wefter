import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectSplashConfig } from "../src/inject-splash.js";

const BUILD_GRADLE_FIXTURE = `android {
    defaultConfig {
        // WEFTER-SPLASH-CONFIG-START
        buildConfigField("boolean", "SPLASH_ENABLED", "false")
        buildConfigField("long", "SPLASH_MIN_DURATION_MS", "600L")
        buildConfigField("long", "SPLASH_FADE_OUT_MS", "300L")
        // WEFTER-SPLASH-CONFIG-END
    }
}
`;

let tmpDir: string;
let gradlePath: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("injectSplashConfig", () => {
  it("injects enabled, minDurationMs, and fadeOutDurationMs as buildConfigFields", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-splash-inject-"));
    gradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(gradlePath, BUILD_GRADLE_FIXTURE);

    injectSplashConfig(gradlePath, { enabled: true, minDurationMs: 1200, fadeOutDurationMs: 500 });

    const result = readFileSync(gradlePath, "utf-8");
    expect(result).toContain('buildConfigField("boolean", "SPLASH_ENABLED", "true")');
    expect(result).toContain('buildConfigField("long", "SPLASH_MIN_DURATION_MS", "1200L")');
    expect(result).toContain('buildConfigField("long", "SPLASH_FADE_OUT_MS", "500L")');
  });

  it("replaces existing injected values on a second run instead of duplicating them", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-splash-inject-"));
    gradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(gradlePath, BUILD_GRADLE_FIXTURE);

    injectSplashConfig(gradlePath, { enabled: true, minDurationMs: 1200, fadeOutDurationMs: 500 });
    injectSplashConfig(gradlePath, { enabled: false, minDurationMs: 900, fadeOutDurationMs: 250 });

    const result = readFileSync(gradlePath, "utf-8");
    expect(result).not.toContain("1200L");
    expect(result).toContain('buildConfigField("boolean", "SPLASH_ENABLED", "false")');
    expect(result).toContain('buildConfigField("long", "SPLASH_MIN_DURATION_MS", "900L")');
    const markerCount = result.split("// WEFTER-SPLASH-CONFIG-START").length - 1;
    expect(markerCount).toBe(1);
  });

  it("throws clearly when the marker block is missing", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-splash-inject-"));
    gradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(gradlePath, "android {}\n");

    expect(() =>
      injectSplashConfig(gradlePath, { enabled: false, minDurationMs: 600, fadeOutDurationMs: 300 })
    ).toThrow(/WEFTER-SPLASH-CONFIG-START/);
  });
});
