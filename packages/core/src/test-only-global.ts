/**
 * Exposes the bridge as `window.Wefter` for the native shells' bundled test page. Not part of the
 * public API.
 */

import { invokeNative, registerHook } from "./index.js";

declare global {
  interface Window {
    Wefter: { invokeNative: typeof invokeNative; registerHook: typeof registerHook };
  }
}

window.Wefter = { invokeNative, registerHook };
