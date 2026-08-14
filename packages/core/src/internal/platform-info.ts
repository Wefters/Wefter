import { isNativeBridgeAvailable } from "./native-bridge.js";
import { CORE_VERSION } from "./version.js";

export const CORE_PROTOCOL_VERSION = 1;

export interface PlatformInfo {
  platform: "android" | "ios" | "web";
  coreVersion: string;
  environment: string;
}

export function getPlatformInfo(): PlatformInfo {
  return {
    platform: detectPlatform(),
    coreVersion: CORE_VERSION,
    environment: getEnvironment(),
  };
}

function detectPlatform(): PlatformInfo["platform"] {
  if (typeof window === "undefined") return "web";
  if (window.AndroidBridge) return "android";
  if (window.webkit?.messageHandlers?.WefterBridge) return "ios";
  return "web";
}

function getEnvironment(): string {
  if (typeof window === "undefined") return "unknown";
  if (window.AndroidBridge?.getEnvironment) return window.AndroidBridge.getEnvironment();

  if (window.__WEFTER_IOS_ENV__) return window.__WEFTER_IOS_ENV__;
  return "unknown";
}
