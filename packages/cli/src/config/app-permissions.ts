/**
 * The native permissions behind the `permissions` of `wefter.config.json`: the camera, microphone and
 * location the web app uses through standard web APIs (`getUserMedia`, `<input type="file" capture>`,
 * `navigator.geolocation`).
 */

import type { AppPermissionsConfig } from "./wefter-config-schema.js";

type AppPermission = keyof AppPermissionsConfig;

/** Android permissions for each feature. `MODIFY_AUDIO_SETTINGS` lets the web view route call audio. */
const ANDROID_PERMISSIONS: Record<AppPermission, string[]> = {
  camera: ["android.permission.CAMERA"],
  microphone: ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"],
  location: ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
};

/** `Info.plist` usage description key for each feature. */
const IOS_USAGE_KEYS: Record<AppPermission, string> = {
  camera: "NSCameraUsageDescription",
  microphone: "NSMicrophoneUsageDescription",
  location: "NSLocationWhenInUseUsageDescription",
};

/** The Android permissions the configured features need. */
export function androidAppPermissions(permissions: AppPermissionsConfig | undefined): string[] {
  if (!permissions) return [];
  return (Object.keys(ANDROID_PERMISSIONS) as AppPermission[])
    .filter((feature) => permissions[feature] !== undefined)
    .flatMap((feature) => ANDROID_PERMISSIONS[feature]);
}

/** The `Info.plist` usage descriptions of the configured features, by key. */
export function iosAppUsageDescriptions(permissions: AppPermissionsConfig | undefined): Record<string, string> {
  const descriptions: Record<string, string> = {};
  if (!permissions) return descriptions;
  for (const feature of Object.keys(IOS_USAGE_KEYS) as AppPermission[]) {
    const description = permissions[feature];
    if (description !== undefined) descriptions[IOS_USAGE_KEYS[feature]] = description;
  }
  return descriptions;
}
