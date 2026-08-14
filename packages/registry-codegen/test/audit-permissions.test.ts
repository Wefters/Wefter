import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditPluginPermissions } from "../src/audit-permissions.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";

function makePlugin(name: string, kotlinSource: string, declaredPermissions: string[]): DiscoveredPlugin {
  const dir = mkdtempSync(join(tmpdir(), "wefter-audit-"));
  const packageDir = join(dir, name);
  mkdirSync(join(packageDir, "android"), { recursive: true });
  writeFileSync(join(packageDir, "android", "Plugin.kt"), kotlinSource);
  return {
    manifest: {
      name,
      permissions: { android: declaredPermissions, ios: {} },
      nativeDependencies: {},
      hooks: [],
      events: [],
      methods: [],
    },
    packageDir,
  };
}

describe("auditPluginPermissions", () => {
  it("flags a plugin using CameraX without declaring CAMERA", () => {
    const plugin = makePlugin("cam", "import androidx.camera.core.CameraX\n", []);

    const violations = auditPluginPermissions([plugin]);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("cam");
    expect(violations[0]).toContain("CameraX");
    expect(violations[0]).toContain("android.permission.CAMERA");

    rmSync(plugin.packageDir, { recursive: true, force: true });
  });

  it("passes when the sensitive API's permission is declared", () => {
    const plugin = makePlugin("cam", "import androidx.camera.core.CameraX\n", ["android.permission.CAMERA"]);

    expect(auditPluginPermissions([plugin])).toEqual([]);

    rmSync(plugin.packageDir, { recursive: true, force: true });
  });

  it("passes when no sensitive API is referenced at all", () => {
    const plugin = makePlugin("plain", "class Plain\n", []);

    expect(auditPluginPermissions([plugin])).toEqual([]);

    rmSync(plugin.packageDir, { recursive: true, force: true });
  });
});
