import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeInfoPlist } from "../src/merge-info-plist.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";

function pluginWithIosPermissions(name: string, perms: Record<string, string>): DiscoveredPlugin {
  return {
    packageDir: `/fake/${name}`,
    manifest: {
      name,
      permissions: { android: [], ios: perms },
      nativeDependencies: {},
      hooks: [],
      events: [],
      methods: [],
    },
  };
}

const INITIAL_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>

	<!-- WEFTER-PERMISSIONS-START -->
	<!-- WEFTER-PERMISSIONS-END -->
</dict>
</plist>
`;

let tmpDir: string;
let plistPath: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("mergeInfoPlist", () => {
  it("inserts a <key>/<string> pair for each permission entry between the markers", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-plist-"));
    plistPath = join(tmpDir, "Info.plist");
    writeFileSync(plistPath, INITIAL_PLIST);

    mergeInfoPlist(
      [pluginWithIosPermissions("camera", { NSCameraUsageDescription: "Used to scan codes." })],
      plistPath,
    );

    const result = readFileSync(plistPath, "utf-8");
    expect(result).toContain("<key>NSCameraUsageDescription</key>");
    expect(result).toContain("<string>Used to scan codes.</string>");
  });

  it("XML-escapes description text containing special characters", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-plist-"));
    plistPath = join(tmpDir, "Info.plist");
    writeFileSync(plistPath, INITIAL_PLIST);

    mergeInfoPlist(
      [pluginWithIosPermissions("camera", { NSCameraUsageDescription: 'Scan & <verify> "codes"' })],
      plistPath,
    );

    const result = readFileSync(plistPath, "utf-8");
    expect(result).toContain("Scan &amp; &lt;verify&gt; &quot;codes&quot;");
    expect(result).not.toContain('Scan & <verify> "codes"');
  });

  it("merges entries from multiple plugins", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-plist-"));
    plistPath = join(tmpDir, "Info.plist");
    writeFileSync(plistPath, INITIAL_PLIST);

    mergeInfoPlist(
      [
        pluginWithIosPermissions("camera", { NSCameraUsageDescription: "Camera." }),
        pluginWithIosPermissions("mic", { NSMicrophoneUsageDescription: "Mic." }),
      ],
      plistPath,
    );

    const result = readFileSync(plistPath, "utf-8");
    expect(result).toContain("NSCameraUsageDescription");
    expect(result).toContain("NSMicrophoneUsageDescription");
  });

  it("a later plugin's description for the same key wins over an earlier one", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-plist-"));
    plistPath = join(tmpDir, "Info.plist");
    writeFileSync(plistPath, INITIAL_PLIST);

    const merged = mergeInfoPlist(
      [
        pluginWithIosPermissions("a", { NSCameraUsageDescription: "First." }),
        pluginWithIosPermissions("b", { NSCameraUsageDescription: "Second." }),
      ],
      plistPath,
    );

    expect(merged.NSCameraUsageDescription).toBe("Second.");
  });

  it("replaces the existing marked block on a second run instead of duplicating it", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-plist-"));
    plistPath = join(tmpDir, "Info.plist");
    writeFileSync(plistPath, INITIAL_PLIST);

    mergeInfoPlist([pluginWithIosPermissions("camera", { NSCameraUsageDescription: "Camera." })], plistPath);
    mergeInfoPlist([pluginWithIosPermissions("mic", { NSMicrophoneUsageDescription: "Mic." })], plistPath);

    const result = readFileSync(plistPath, "utf-8");
    const markerCount = result.split("<!-- WEFTER-PERMISSIONS-START -->").length - 1;
    expect(markerCount).toBe(1);
    expect(result).not.toContain("NSCameraUsageDescription");
    expect(result).toContain("NSMicrophoneUsageDescription");
  });

  it("leaves an empty block when no plugin declares any iOS permission", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-plist-"));
    plistPath = join(tmpDir, "Info.plist");
    writeFileSync(plistPath, INITIAL_PLIST);

    mergeInfoPlist([pluginWithIosPermissions("plain", {})], plistPath);

    const result = readFileSync(plistPath, "utf-8");
    expect(result).toContain("<!-- WEFTER-PERMISSIONS-START -->");
    expect(result).toContain("<!-- WEFTER-PERMISSIONS-END -->");
  });
});
