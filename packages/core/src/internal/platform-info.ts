import { CORE_VERSION } from "./version.js";

/** Version of the message format between core and the native shells. Raised on breaking bridge changes. */
export const CORE_PROTOCOL_VERSION = 1;

/** Where the app is running and which build of core and environment it uses. */
export interface PlatformInfo {
  platform: "android" | "ios" | "web";
  coreVersion: string;
  environment: string;
}

/**
 * Describes the current runtime: the platform, the core version and the environment name the native
 * shell was built with (`unknown` in a browser).
 */
export function getPlatformInfo(): PlatformInfo {
  return {
    platform: detectPlatform(),
    coreVersion: CORE_VERSION,
    environment: getEnvironment(),
  };
}

/** Detects the platform from whichever native bridge was injected. */
function detectPlatform(): PlatformInfo["platform"] {
  if (typeof window === "undefined") return "web";
  if (window.AndroidBridge) return "android";
  if (window.webkit?.messageHandlers?.WefterBridge) return "ios";
  return "web";
}

/** Reads the environment name the native shell injected (from `wefter.config` environments). */
function getEnvironment(): string {
  if (typeof window === "undefined") return "unknown";
  if (window.AndroidBridge?.getEnvironment) return window.AndroidBridge.getEnvironment();

  if (window.__WEFTER_IOS_ENV__) return window.__WEFTER_IOS_ENV__;
  return "unknown";
}
