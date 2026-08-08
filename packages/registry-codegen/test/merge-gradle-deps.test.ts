import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeGradleDeps } from "../src/merge-gradle-deps.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";

function pluginWithDep(name: string, gradleDep?: string): DiscoveredPlugin {
  return {
    packageDir: `/fake/${name}`,
    manifest: {
      name,
      permissions: { android: [], ios: {} },
      nativeDependencies: gradleDep ? { android: { gradle: gradleDep } } : {},
      hooks: [],
      events: [],
    },
  };
}

const INITIAL_BUILD_GRADLE = `plugins {
    id("com.android.application")
}

android {
    namespace = "dev.wefter.bridge"
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
}
`;

let tmpDir: string;
let buildGradlePath: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("mergeGradleDeps", () => {
  it("inserts the marker block with plugin deps on a first run with no markers yet", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-gradle-"));
    buildGradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(buildGradlePath, INITIAL_BUILD_GRADLE);

    mergeGradleDeps([pluginWithDep("scanner", "com.google.mlkit:barcode-scanning:17.2.0")], buildGradlePath);

    const result = readFileSync(buildGradlePath, "utf-8");
    expect(result).toContain("// WEFTER-PLUGIN-DEPS-START");
    expect(result).toContain('implementation("com.google.mlkit:barcode-scanning:17.2.0")');
    expect(result).toContain("// WEFTER-PLUGIN-DEPS-END");
    expect(result).toContain('implementation("androidx.core:core-ktx:1.12.0")');
  });

  it("replaces the existing marked block on a second run instead of duplicating it", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-gradle-"));
    buildGradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(buildGradlePath, INITIAL_BUILD_GRADLE);

    mergeGradleDeps([pluginWithDep("scanner", "com.google.mlkit:barcode-scanning:17.2.0")], buildGradlePath);
    mergeGradleDeps([pluginWithDep("scanner", "com.google.mlkit:barcode-scanning:17.2.0"), pluginWithDep("device-info")], buildGradlePath);

    const result = readFileSync(buildGradlePath, "utf-8");
    const markerCount = result.split("// WEFTER-PLUGIN-DEPS-START").length - 1;
    expect(markerCount).toBe(1);
    expect(result).toContain('implementation("com.google.mlkit:barcode-scanning:17.2.0")');
  });

  it("skips plugins that declare no gradle dependency", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-gradle-"));
    buildGradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(buildGradlePath, INITIAL_BUILD_GRADLE);

    mergeGradleDeps([pluginWithDep("device-info")], buildGradlePath);

    const result = readFileSync(buildGradlePath, "utf-8");
    expect(result).toContain("// WEFTER-PLUGIN-DEPS-START");
    expect(result).toContain("// WEFTER-PLUGIN-DEPS-END");
  });
});
