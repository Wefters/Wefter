import { invokeNative, registerHook } from "./index.js";

declare global {
  interface Window {
    Wefter: { invokeNative: typeof invokeNative; registerHook: typeof registerHook };
  }
}

window.Wefter = { invokeNative, registerHook };
