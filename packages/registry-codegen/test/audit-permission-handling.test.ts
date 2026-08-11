import { describe, expect, it } from "vitest";
import { auditPermissionHandling } from "../src/audit-permission-handling.js";
import type { PluginManifest } from "../src/schema/plugin-schema.js";

function manifest(declaredPermissions: string[]): PluginManifest {
  return {
    name: "scanner",
    permissions: { android: declaredPermissions, ios: {} },
    nativeDependencies: {},
    methods: [],
    hooks: [],
    events: [],
  };
}

describe("auditPermissionHandling", () => {
  it("flags a plugin that declares permissions but never rejects with PERMISSION_DENIED", () => {
    const source = `
      class ScannerPlugin(context: Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher) {
        fun open(payload: JSONObject, callback: (Result<Any>) -> Unit) {
          resolve(callback)
        }
      }
    `;

    const issues = auditPermissionHandling(manifest(["android.permission.CAMERA"]), source);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("scanner");
    expect(issues[0]).toContain("PERMISSION_DENIED");
  });

  it("passes when a method rejects with PERMISSION_DENIED somewhere in source", () => {
    const source = `
      requestPermission(activity, Manifest.permission.CAMERA) { granted ->
        if (!granted) reject(callback, "PERMISSION_DENIED", "Camera permission not granted")
      }
    `;

    expect(auditPermissionHandling(manifest(["android.permission.CAMERA"]), source)).toEqual([]);
  });

  it("skips the check entirely when plugin.json declares no Android permissions", () => {
    const source = "class Plain\n";

    expect(auditPermissionHandling(manifest([]), source)).toEqual([]);
  });

  it("does not flag a 'normal' protection-level permission like INTERNET, which is granted at install time and never denied at runtime", () => {
    const source = "class DeviceInfoPlugin(context: Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher)\n";

    expect(auditPermissionHandling(manifest(["android.permission.INTERNET"]), source)).toEqual([]);
  });

  it("still flags a dangerous permission even when it's declared alongside a normal one", () => {
    const source = "class Plugin\n";

    const issues = auditPermissionHandling(
      manifest(["android.permission.INTERNET", "android.permission.CAMERA"]),
      source,
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("android.permission.CAMERA");
    expect(issues[0]).not.toContain("android.permission.INTERNET");
  });
});
