import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractRequiredPluginConfigKeys, mergeManifestEntries } from "../src/manifest-entries.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";
import type { ManifestEntry } from "../src/schema/plugin-schema.js";

function pluginWithEntries(name: string, entries: ManifestEntry[]): DiscoveredPlugin {
  return {
    packageDir: `/fake/${name}`,
    manifest: {
      name,
      permissions: { android: [], ios: {} },
      nativeDependencies: {},
      android: { manifestEntries: entries },
      methods: [],
      hooks: [],
      events: [],
    },
  };
}

const AUTH_ACTIVITY: ManifestEntry = {
  type: "activity",
  name: ".BrowserAuthActivity",
  exported: true,
  intentFilters: [
    {
      action: "android.intent.action.VIEW",
      categories: ["android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"],
      data: { scheme: "${appScheme}" },
    },
  ],
};

const INITIAL_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application android:label="Wefter">
        <activity android:name=".MainActivity" android:exported="true"></activity>
    </application>

</manifest>
`;

let tmpDir: string;
let manifestPath: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function setup(): void {
  tmpDir = mkdtempSync(join(tmpdir(), "wefter-manifest-entries-"));
  manifestPath = join(tmpDir, "AndroidManifest.xml");
  writeFileSync(manifestPath, INITIAL_MANIFEST);
}

describe("mergeManifestEntries", () => {
  it("weaves an activity with a resolved intent-filter as a child of <application>", () => {
    setup();

    mergeManifestEntries([pluginWithEntries("browser", [AUTH_ACTIVITY])], manifestPath, { appScheme: "myapp" });

    const result = readFileSync(manifestPath, "utf-8");
    expect(result).toContain('<activity');
    expect(result).toContain('android:name=".BrowserAuthActivity"');
    expect(result).toContain('android:exported="true"');
    expect(result).toContain('<action android:name="android.intent.action.VIEW" />');
    expect(result).toContain('<category android:name="android.intent.category.DEFAULT" />');
    expect(result).toContain('<category android:name="android.intent.category.BROWSABLE" />');
    expect(result).toContain('<data android:scheme="myapp" />');

    const applicationOpenIndex = result.indexOf("<application");
    const applicationCloseIndex = result.indexOf("</application>");
    const activityIndex = result.indexOf('android:name=".BrowserAuthActivity"');
    expect(activityIndex).toBeGreaterThan(applicationOpenIndex);
    expect(activityIndex).toBeLessThan(applicationCloseIndex);
  });

  it("throws a clear error naming the missing pluginConfig key instead of silently omitting the entry", () => {
    setup();

    expect(() => mergeManifestEntries([pluginWithEntries("browser", [AUTH_ACTIVITY])], manifestPath, {})).toThrow(
      /appScheme/,
    );
  });

  it("replaces the existing marked block on a second run instead of duplicating it", () => {
    setup();

    mergeManifestEntries([pluginWithEntries("browser", [AUTH_ACTIVITY])], manifestPath, { appScheme: "myapp" });
    mergeManifestEntries([], manifestPath, {});

    const result = readFileSync(manifestPath, "utf-8");
    const markerCount = result.split("<!-- WEFTER-COMPONENTS-START -->").length - 1;
    expect(markerCount).toBe(1);
    expect(result).not.toContain("BrowserAuthActivity");
  });

  it("returns which entries were added, including their exported flag", () => {
    setup();

    const added = mergeManifestEntries([pluginWithEntries("browser", [AUTH_ACTIVITY])], manifestPath, {
      appScheme: "myapp",
    });

    expect(added).toEqual([
      { pluginName: "browser", type: "activity", name: ".BrowserAuthActivity", exported: true },
    ]);
  });

  it("writes an empty marker block when no plugin declares any manifest entries", () => {
    setup();

    mergeManifestEntries([], manifestPath, {});

    const result = readFileSync(manifestPath, "utf-8");
    expect(result).toContain("<!-- WEFTER-COMPONENTS-START -->");
    expect(result).toContain("<!-- WEFTER-COMPONENTS-END -->");
  });
});

describe("extractRequiredPluginConfigKeys", () => {
  it("finds a placeholder referenced in an intent-filter's data block", () => {
    const keys = extractRequiredPluginConfigKeys(pluginWithEntries("browser", [AUTH_ACTIVITY]).manifest);
    expect(keys).toEqual(["appScheme"]);
  });

  it("returns an empty array for a plugin with no manifestEntries at all", () => {
    const keys = extractRequiredPluginConfigKeys(pluginWithEntries("browser", []).manifest);
    expect(keys).toEqual([]);
  });

  it("returns an empty array when the entry has no placeholders", () => {
    const entry: ManifestEntry = {
      type: "activity",
      name: ".SomeActivity",
      exported: false,
      intentFilters: [{ action: "android.intent.action.VIEW", categories: [], data: { scheme: "fixed-scheme" } }],
    };
    const keys = extractRequiredPluginConfigKeys(pluginWithEntries("browser", [entry]).manifest);
    expect(keys).toEqual([]);
  });
});
