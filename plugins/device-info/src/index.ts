import { invokeNative } from "@wefter/core";

export interface DeviceInfo {
  platform: string;
  osVersion: string;
}

export const Device = {
  getInfo(): Promise<DeviceInfo> {
    return invokeNative("device-info", "getInfo") as Promise<DeviceInfo>;
  },
};
