export { invokeNative, registerHook, onBridgeReady, isNativeBridgeAvailable } from "./internal/native-bridge.js";
export { WefterBridgeError, type WefterErrorCode } from "./internal/errors.js";
export { getPlatformInfo, CORE_PROTOCOL_VERSION, type PlatformInfo } from "./internal/platform-info.js";
export { definePlugin } from "./internal/define-plugin.js";
export { hideSplash } from "./internal/hide-splash.js";
export { getDeviceInfo, type DeviceInfo } from "./internal/device-info.js";

import "./internal/error-safety-net.js";
