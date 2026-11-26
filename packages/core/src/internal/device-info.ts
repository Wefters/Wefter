import { invokeNative } from "./native-bridge.js";

/** Basic facts about the device the app is running on. */
export interface DeviceInfo {
  platform: string;
  osVersion: string;
}

/** Asks the native shell for the platform name and OS version. */
export function getDeviceInfo(): Promise<DeviceInfo> {
  return invokeNative("__system", "getDeviceInfo", {});
}
