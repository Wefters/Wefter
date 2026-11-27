import type { PluginManifest } from "./schema/plugin-schema.js";

/**
 * Android runtime ("dangerous") permissions. The user can deny these, so a plugin that requests one has
 * to handle the denial.
 */
const DANGEROUS_ANDROID_PERMISSIONS = new Set([
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "android.permission.CAMERA",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
  "android.permission.GET_ACCOUNTS",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_PHONE_STATE",
  "android.permission.READ_PHONE_NUMBERS",
  "android.permission.CALL_PHONE",
  "android.permission.ANSWER_PHONE_CALLS",
  "android.permission.ADD_VOICEMAIL",
  "android.permission.USE_SIP",
  "android.permission.PROCESS_OUTGOING_CALLS",
  "android.permission.READ_CALL_LOG",
  "android.permission.WRITE_CALL_LOG",
  "android.permission.BODY_SENSORS",
  "android.permission.ACTIVITY_RECOGNITION",
  "android.permission.SEND_SMS",
  "android.permission.RECEIVE_SMS",
  "android.permission.READ_SMS",
  "android.permission.RECEIVE_WAP_PUSH",
  "android.permission.RECEIVE_MMS",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_ADVERTISE",
  "android.permission.NEARBY_WIFI_DEVICES",
]);

/**
 * Checks that a plugin requesting a dangerous Android permission can report a denial, by looking for a
 * `PERMISSION_DENIED` rejection in its Kotlin source. This is a text search, not proof the handling is
 * correct.
 *
 * @returns One message per problem; empty when the plugin passes.
 */
export function auditPermissionHandling(manifest: PluginManifest, androidSource: string): string[] {
  const declared = (manifest.permissions?.android ?? []).filter((permission) =>
    DANGEROUS_ANDROID_PERMISSIONS.has(permission),
  );
  if (declared.length === 0) return [];

  if (!androidSource.includes("PERMISSION_DENIED")) {
    return [
      `Plugin "${manifest.name}" declares dangerous Android permission(s) (${declared.join(", ")}) but no ` +
        `method rejects with "PERMISSION_DENIED" — a denied permission would likely hang or crash instead of ` +
        `failing cleanly. (This is a string match on the source, not a guarantee the handling is correct.)`,
    ];
  }

  return [];
}

/**
 * iOS usage descriptions whose permission has no status to check before using it: Face ID asks the first
 * time it is used, and iOS can't tell "not asked yet" from "allowed".
 */
const IOS_KEYS_WITHOUT_STATUS = new Set(["NSFaceIDUsageDescription"]);

/**
 * Checks that a plugin requesting a dangerous Android permission, or declaring an iOS usage description,
 * lets apps see and ask for it the way every Wefter plugin does: `checkPermissions()` and
 * `requestPermissions()`, which report `granted`, `prompt`, `denied` or `limited`.
 *
 * @returns One warning per problem; empty when the plugin passes.
 */
export function permissionApiWarnings(manifest: PluginManifest): string[] {
  const android = (manifest.permissions?.android ?? []).filter((p) => DANGEROUS_ANDROID_PERMISSIONS.has(p));
  const ios = Object.keys(manifest.permissions?.ios ?? {}).filter((key) => !IOS_KEYS_WITHOUT_STATUS.has(key));
  if (android.length === 0 && ios.length === 0) return [];
  const missing = ["checkPermissions", "requestPermissions"].filter((m) => !(manifest.methods ?? []).includes(m));
  if (missing.length === 0) return [];
  return [
    `Plugin "${manifest.name}" needs permissions (${[...android, ...ios].join(", ")}) but has no ` +
      `${missing.join(" or ")} method. Add both, so apps can show where a permission stands and ask for it ` +
      `before using the plugin.`,
  ];
}
