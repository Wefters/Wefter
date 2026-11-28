/**
 * Public entry point of `@wefterjs/core`: the bridge to native code, platform helpers, deep links and
 * `definePlugin`.
 *
 * The side-effect imports at the bottom install the DevTools instrumentation (console, uncaught errors,
 * network, presence and remote reload). Each of them only activates under the Vite dev server
 * (`import.meta.hot`), so production bundles carry no DevTools behaviour.
 */

export { invokeNative, registerHook, onBridgeReady, isNativeBridgeAvailable } from "./internal/native-bridge.js";
export { WefterBridgeError, type WefterErrorCode } from "./internal/errors.js";
export { getPlatformInfo, CORE_PROTOCOL_VERSION, type PlatformInfo } from "./internal/platform-info.js";
export { definePlugin } from "./internal/define-plugin.js";
export { hideSplash } from "./internal/hide-splash.js";
export { getDeviceInfo, type DeviceInfo } from "./internal/device-info.js";
export { isLandscape } from "./internal/landscape.js";
export { onDeepLink, getLaunchUrl, type DeepLink, type DeepLinkSubscription } from "./internal/deep-links.js";
export { openAppSettings, type PermissionState, type PermissionStatus } from "./internal/permissions.js";
export {
  exposeToFrames,
  type FrameCallContext,
  type FrameHost,
  type FrameMethod,
  type FrameMethods,
} from "./internal/frames.js";
export {
  openWebWindow,
  type WebWindow,
  type WebWindowCallContext,
  type WebWindowCloseReason,
  type WebWindowEvents,
  type WebWindowOptions,
} from "./internal/web-window.js";

export { onBack, type BackEvent, type BackListener } from "./internal/back.js";
export {
  getSystemBars,
  setSystemBars,
  getGestures,
  setGestures,
  getSafeArea,
  onSafeAreaChange,
  type SafeArea,
  type SystemBars,
  type SystemBarsState,
  type Gestures,
  type GesturesState,
  type GestureArea,
  type Supported,
} from "./internal/system-ui.js";

import "./internal/devtools/console-patch.js";
import "./internal/devtools/uncaught.js";
import "./internal/devtools/network-patch.js";
import "./internal/devtools/presence.js";
import "./internal/devtools/reload.js";
