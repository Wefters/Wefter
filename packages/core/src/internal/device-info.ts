import { invokeNative } from "./native-bridge.js";

export interface DeviceInfo {
  platform: string;
  osVersion: string;
}

export function getDeviceInfo(): Promise<DeviceInfo> {
  return invokeNative("__system", "getDeviceInfo", {});
}
