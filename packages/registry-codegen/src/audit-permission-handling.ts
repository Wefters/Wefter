import type { PluginManifest } from "./schema/plugin-schema.js";

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
