import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeGradleMerge, mergeGradleDeps } from "../src/merge-gradle-deps.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";

function pluginWithDep(name: string, ...gradleDeps: string[]): DiscoveredPlugin {
  return {
    packageDir: `/fake/${name}`,
    manifest: {
      name,
      permissions: { android: [], ios: {} },
      nativeDependencies: gradleDeps.length > 0 ? { android: { gradle: gradleDeps } } : {},
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
    mergeGradleDeps(
      [pluginWithDep("scanner", "com.google.mlkit:barcode-scanning:17.2.0"), pluginWithDep("device-info")],
      buildGradlePath,
    );

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

  it("writes every artifact a single plugin declares, not just the first", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-gradle-"));
    buildGradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(buildGradlePath, INITIAL_BUILD_GRADLE);

    mergeGradleDeps(
      [
        pluginWithDep(
          "camera",
          "androidx.camera:camera-camera2:1.6.1",
          "androidx.camera:camera-lifecycle:1.6.1",
          "androidx.camera:camera-view:1.6.1",
          "com.google.mlkit:barcode-scanning:17.3.0",
        ),
      ],
      buildGradlePath,
    );

    const result = readFileSync(buildGradlePath, "utf-8");
    expect(result).toContain('implementation("androidx.camera:camera-camera2:1.6.1")');
    expect(result).toContain('implementation("androidx.camera:camera-lifecycle:1.6.1")');
    expect(result).toContain('implementation("androidx.camera:camera-view:1.6.1")');
    expect(result).toContain('implementation("com.google.mlkit:barcode-scanning:17.3.0")');
  });
});

describe("computeGradleMerge — version conflicts", () => {
  it("reports no conflict when only one plugin declares a given artifact", () => {
    const { conflicts } = computeGradleMerge([pluginWithDep("scanner", "androidx.camera:camera-core:1.3.0")]);
    expect(conflicts).toEqual([]);
  });

  it("reports no conflict when two plugins agree on the exact same coordinate", () => {
    const { conflicts, deps } = computeGradleMerge([
      pluginWithDep("scanner", "androidx.camera:camera-core:1.3.0"),
      pluginWithDep("camera", "androidx.camera:camera-core:1.3.0"),
    ]);
    expect(conflicts).toEqual([]);
    expect(deps).toEqual(["androidx.camera:camera-core:1.3.0"]);
  });

  it("reports no conflict for a minor/patch version difference — only major mismatches are flagged", () => {
    const { conflicts, deps } = computeGradleMerge([
      pluginWithDep("scanner", "androidx.camera:camera-core:1.3.0"),
      pluginWithDep("camera", "androidx.camera:camera-core:1.3.1"),
    ]);
    expect(conflicts).toEqual([]);
    expect(deps).toEqual(["androidx.camera:camera-core:1.3.1"]);
  });

  it("flags a major-version conflict between two plugins declaring the same artifact and resolves to the highest version", () => {
    const { conflicts, deps } = computeGradleMerge([
      pluginWithDep("scanner", "androidx.camera:camera-core:1.3.0"),
      pluginWithDep("camera", "androidx.camera:camera-core:2.0.0"),
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain("androidx.camera:camera-core");
    expect(conflicts[0]).toContain("scanner@1.3.0");
    expect(conflicts[0]).toContain("camera@2.0.0");
    expect(deps).toEqual(["androidx.camera:camera-core:2.0.0"]);
  });

  it("keeps an unparseable coordinate as-is, deduplicated, without treating it as a conflict", () => {
    const { conflicts, deps } = computeGradleMerge([
      pluginWithDep("weird", "not-a-real-coordinate"),
      pluginWithDep("weird-too", "not-a-real-coordinate"),
    ]);

    expect(conflicts).toEqual([]);
    expect(deps).toEqual(["not-a-real-coordinate"]);
  });
});
