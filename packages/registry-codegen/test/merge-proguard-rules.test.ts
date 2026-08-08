import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeProguardRules } from "../src/merge-proguard-rules.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";

function pluginWithRules(name: string, proguardRules?: string): DiscoveredPlugin {
  return {
    packageDir: `/fake/${name}`,
    manifest: {
      name,
      permissions: { android: [], ios: {} },
      nativeDependencies: proguardRules ? { android: { proguardRules } } : {},
      hooks: [],
      events: [],
    },
  };
}

const INITIAL_PROGUARD = `# WEFTER-PROGUARD-RULES-START

# WEFTER-PROGUARD-RULES-END
`;

let tmpDir: string;
let proguardPath: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("mergeProguardRules", () => {
  it("inserts a plugin's proguard rules into the marker block", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-proguard-"));
    proguardPath = join(tmpDir, "proguard-rules.pro");
    writeFileSync(proguardPath, INITIAL_PROGUARD);

    mergeProguardRules([pluginWithRules("scanner", "-keep class com.scanner.** { *; }")], proguardPath);

    const result = readFileSync(proguardPath, "utf-8");
    expect(result).toContain("# WEFTER-PROGUARD-RULES-START");
    expect(result).toContain("-keep class com.scanner.** { *; }");
    expect(result).toContain("# WEFTER-PROGUARD-RULES-END");
  });

  it("replaces the existing marked block on a second run instead of duplicating it", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-proguard-"));
    proguardPath = join(tmpDir, "proguard-rules.pro");
    writeFileSync(proguardPath, INITIAL_PROGUARD);

    mergeProguardRules([pluginWithRules("scanner", "-keep class com.scanner.** { *; }")], proguardPath);
    mergeProguardRules([pluginWithRules("scanner", "-keep class com.scanner.** { *; }"), pluginWithRules("device-info")], proguardPath);

    const result = readFileSync(proguardPath, "utf-8");
    const markerCount = result.split("# WEFTER-PROGUARD-RULES-START").length - 1;
    expect(markerCount).toBe(1);
  });

  it("adds the marker block when the file has none yet", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-proguard-"));
    proguardPath = join(tmpDir, "proguard-rules.pro");
    writeFileSync(proguardPath, "# hand-written rule\n-dontwarn com.example.**\n");

    mergeProguardRules([pluginWithRules("scanner", "-keep class com.scanner.** { *; }")], proguardPath);

    const result = readFileSync(proguardPath, "utf-8");
    expect(result).toContain("-dontwarn com.example.**");
    expect(result).toContain("-keep class com.scanner.** { *; }");
  });
});
