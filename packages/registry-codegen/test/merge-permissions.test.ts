import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergePermissions } from "../src/merge-permissions.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";

function pluginWithPermissions(name: string, perms: string[]): DiscoveredPlugin {
  return {
    packageDir: `/fake/${name}`,
    manifest: {
      name,
      permissions: { android: perms, ios: {} },
      nativeDependencies: {},
      hooks: [],
      events: [],
    },
  };
}

const INITIAL_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application android:label="Wefter">
    </application>

</manifest>
`;

let tmpDir: string;
let manifestPath: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("mergePermissions", () => {
  it("inserts uses-permission tags as children of <manifest>, not before it", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-manifest-"));
    manifestPath = join(tmpDir, "AndroidManifest.xml");
    writeFileSync(manifestPath, INITIAL_MANIFEST);

    mergePermissions([pluginWithPermissions("camera", ["android.permission.CAMERA"])], manifestPath);

    const result = readFileSync(manifestPath, "utf-8");
    expect(result).toContain('<uses-permission android:name="android.permission.CAMERA" />');

    const manifestOpenIndex = result.indexOf("<manifest");
    const permissionIndex = result.indexOf("<uses-permission");
    expect(permissionIndex).toBeGreaterThan(manifestOpenIndex);
    expect(result.indexOf("</manifest>")).toBeGreaterThan(permissionIndex);
  });

  it("deduplicates a permission declared by two different plugins into a single tag", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-manifest-"));
    manifestPath = join(tmpDir, "AndroidManifest.xml");
    writeFileSync(manifestPath, INITIAL_MANIFEST);

    mergePermissions(
      [
        pluginWithPermissions("scanner", ["android.permission.CAMERA"]),
        pluginWithPermissions("photo-capture", ["android.permission.CAMERA"]),
      ],
      manifestPath,
    );

    const result = readFileSync(manifestPath, "utf-8");
    const tagCount = result.split('android:name="android.permission.CAMERA"').length - 1;
    expect(tagCount).toBe(1);
  });

  it("replaces the existing marked block on a second run instead of duplicating it", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-manifest-"));
    manifestPath = join(tmpDir, "AndroidManifest.xml");
    writeFileSync(manifestPath, INITIAL_MANIFEST);

    mergePermissions([pluginWithPermissions("scanner", ["android.permission.CAMERA"])], manifestPath);
    mergePermissions([pluginWithPermissions("mic", ["android.permission.RECORD_AUDIO"])], manifestPath);

    const result = readFileSync(manifestPath, "utf-8");
    const markerCount = result.split("<!-- WEFTER-PERMISSIONS-START -->").length - 1;
    expect(markerCount).toBe(1);
    expect(result).not.toContain("android.permission.CAMERA");
    expect(result).toContain("android.permission.RECORD_AUDIO");
  });
});
