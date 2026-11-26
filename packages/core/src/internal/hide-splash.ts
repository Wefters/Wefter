import { invokeNative } from "./native-bridge.js";

/** Hides the native splash screen. Call it once the first screen of the app has rendered. */
export function hideSplash(): Promise<void> {
  return invokeNative("__system", "hideSplash", {});
}
