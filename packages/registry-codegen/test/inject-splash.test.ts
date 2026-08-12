import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectSplashConfig } from "../src/inject-splash.js";

const BUILD_GRADLE_FIXTURE = `android {
    defaultConfig {
        // WEFTER-SPLASH-CONFIG-START
        buildConfigField("boolean", "SPLASH_ENABLED", "false")
        buildConfigField("long", "SPLASH_MIN_DURATION_MS", "0L")
        buildConfigField("long", "SPLASH_MAX_DURATION_MS", "5000L")
        buildConfigField("boolean", "SPLASH_WAIT_FOR_READY", "true")
        buildConfigField("boolean", "SPLASH_FADE_TRANSITION", "true")
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
  it("injects enabled, minDuration, maxDuration, dismissOn, and transition as buildConfigFields", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-splash-inject-"));
    gradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(gradlePath, BUILD_GRADLE_FIXTURE);

    injectSplashConfig(gradlePath, {
      enabled: true,
      minDuration: 400,
      maxDuration: 3000,
      dismissOn: "timer",
      transition: "none",
    });

    const result = readFileSync(gradlePath, "utf-8");
    expect(result).toContain('buildConfigField("boolean", "SPLASH_ENABLED", "true")');
    expect(result).toContain('buildConfigField("long", "SPLASH_MIN_DURATION_MS", "400L")');
    expect(result).toContain('buildConfigField("long", "SPLASH_MAX_DURATION_MS", "3000L")');
    expect(result).toContain('buildConfigField("boolean", "SPLASH_WAIT_FOR_READY", "false")');
    expect(result).toContain('buildConfigField("boolean", "SPLASH_FADE_TRANSITION", "false")');
  });

  it("replaces existing injected values on a second run instead of duplicating them", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-splash-inject-"));
    gradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(gradlePath, BUILD_GRADLE_FIXTURE);

    injectSplashConfig(gradlePath, {
      enabled: true,
      minDuration: 1200,
      maxDuration: 4000,
      dismissOn: "ready",
      transition: "fade",
    });
    injectSplashConfig(gradlePath, {
      enabled: false,
      minDuration: 900,
      maxDuration: 2500,
      dismissOn: "ready",
      transition: "fade",
    });

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
      injectSplashConfig(gradlePath, {
        enabled: false,
        minDuration: 0,
        maxDuration: 5000,
        dismissOn: "ready",
        transition: "fade",
      }),
    ).toThrow(/WEFTER-SPLASH-CONFIG-START/);
  });
});
