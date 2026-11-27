import { describe, expect, it } from "vitest";
import { androidAppPermissions, iosAppUsageDescriptions } from "../src/config/app-permissions.js";
import { WefterConfigSchema } from "../src/config/wefter-config-schema.js";

describe("app permissions", () => {
  it("maps each configured feature to its Android permissions", () => {
    expect(androidAppPermissions({ camera: "Photos", location: "Stores" })).toEqual([
      "android.permission.CAMERA",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ]);
    expect(androidAppPermissions({ microphone: "Calls" })).toEqual([
      "android.permission.RECORD_AUDIO",
      "android.permission.MODIFY_AUDIO_SETTINGS",
    ]);
    expect(androidAppPermissions(undefined)).toEqual([]);
  });

  it("maps each configured feature to its iOS usage description", () => {
    expect(iosAppUsageDescriptions({ camera: "Take photos", microphone: "Record voice notes" })).toEqual({
      NSCameraUsageDescription: "Take photos",
      NSMicrophoneUsageDescription: "Record voice notes",
    });
    expect(iosAppUsageDescriptions(undefined)).toEqual({});
  });

  it("accepts the three features with a message, and rejects others or empty messages", () => {
    const base = { environments: { development: { appId: "com.example.app", appName: "App" } } };
    expect(WefterConfigSchema.safeParse({ ...base, permissions: { camera: "Take photos" } }).success).toBe(true);
    expect(WefterConfigSchema.safeParse({ ...base, permissions: { camera: "  " } }).success).toBe(false);
    expect(WefterConfigSchema.safeParse({ ...base, permissions: { contacts: "x" } }).success).toBe(false);
  });
});
