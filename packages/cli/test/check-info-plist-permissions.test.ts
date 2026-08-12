import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DiscoveredPlugin } from "@wefterjs/registry-codegen";
import { checkInfoPlistPermissionKeys } from "../src/native/check-info-plist-permissions.js";
import { ejectMarkerPath, iosAppDir } from "../src/config/project-paths.js";

const INFO_PLIST_FIXTURE = (keys: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>

	<!-- WEFTER-PERMISSIONS-START -->
${keys.map((key) => `\t<key>${key}</key>\n\t<string>Some usage description.</string>`).join("\n")}
	<!-- WEFTER-PERMISSIONS-END -->
</dict>
</plist>
`;

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setUpProject(plistKeys: string[]): string {
  dir = mkdtempSync(join(tmpdir(), "wefter-ios-plist-check-"));
  const appDir = iosAppDir(dir);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "Info.plist"), INFO_PLIST_FIXTURE(plistKeys));
  return dir;
}

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

describe("checkInfoPlistPermissionKeys", () => {
  it("passes when the plugin's declared usage description key is present in Info.plist", () => {
    const projectDir = setUpProject(["NSCameraUsageDescription"]);
    const plugins = [pluginWithIosPermissions("scanner", { NSCameraUsageDescription: "Scan codes." })];

    const result = checkInfoPlistPermissionKeys(projectDir, plugins);

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("fails, naming the exact missing key and the exact plugin, when the key is absent from Info.plist", () => {
    const projectDir = setUpProject([]);
    const plugins = [pluginWithIosPermissions("scanner", { NSCameraUsageDescription: "Scan codes." })];

    const result = checkInfoPlistPermissionKeys(projectDir, plugins);

    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain("NSCameraUsageDescription");
    expect(result.issues[0]).toContain("scanner");
    expect(result.issues[0]).toContain("CRASH");
  });

  it("reports only the missing key when one of two plugins' keys is present and the other is missing", () => {
    const projectDir = setUpProject(["NSCameraUsageDescription"]);
    const plugins = [
      pluginWithIosPermissions("scanner", { NSCameraUsageDescription: "Scan codes." }),
      pluginWithIosPermissions("geolocation", { NSLocationWhenInUseUsageDescription: "Find you." }),
    ];

    const result = checkInfoPlistPermissionKeys(projectDir, plugins);

    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain("NSLocationWhenInUseUsageDescription");
    expect(result.issues[0]).toContain("geolocation");
    expect(result.issues[0]).not.toContain("NSCameraUsageDescription");
  });

  it("passes when no declared plugin requires any iOS permission", () => {
    const projectDir = setUpProject([]);
    const plugins = [pluginWithIosPermissions("plain", {})];

    const result = checkInfoPlistPermissionKeys(projectDir, plugins);

    expect(result.passed).toBe(true);
  });

  it("fails clearly when Info.plist itself doesn't exist yet", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-plist-check-"));
    const plugins = [pluginWithIosPermissions("scanner", { NSCameraUsageDescription: "Scan codes." })];

    const result = checkInfoPlistPermissionKeys(dir, plugins);

    expect(result.passed).toBe(false);
    expect(result.issues[0]).toContain("Info.plist not found");
  });

  it("reads the ejected ios/ Info.plist path, not the managed .wefter/native/ios path, once the project is ejected", () => {
    const projectDir = setUpProject(["NSCameraUsageDescription"]);
    writeFileSync(ejectMarkerPath(projectDir), "true\n");

    const managedAppDir = join(projectDir, ".wefter/native/ios/WefterBridge");
    mkdirSync(managedAppDir, { recursive: true });
    writeFileSync(join(managedAppDir, "Info.plist"), INFO_PLIST_FIXTURE([]));

    const ejectedAppDir = join(projectDir, "ios/WefterBridge");
    mkdirSync(ejectedAppDir, { recursive: true });
    writeFileSync(join(ejectedAppDir, "Info.plist"), INFO_PLIST_FIXTURE(["NSCameraUsageDescription"]));

    const plugins = [pluginWithIosPermissions("scanner", { NSCameraUsageDescription: "Scan codes." })];

    const result = checkInfoPlistPermissionKeys(projectDir, plugins);

    expect(result.passed).toBe(true);
  });
});
