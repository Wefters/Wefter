import { invokeNative, isNativeBridgeAvailable } from "./native-bridge.js";

/**
 * Whether the screen is currently in landscape. Asks the native shell when it is available and falls
 * back to CSS media queries or the Screen Orientation API in a plain browser.
 */
export async function isLandscape(): Promise<boolean> {
  if (isNativeBridgeAvailable()) {
    const result = await invokeNative<{ landscape: boolean }>("__system", "isLandscape", {});
    return Boolean(result?.landscape);
  }

  if (typeof window !== "undefined") {
    if (window.matchMedia) {
      return window.matchMedia("(orientation: landscape)").matches;
    }
    if (typeof screen !== "undefined" && screen.orientation) {
      return screen.orientation.type.startsWith("landscape");
    }
  }

  return false;
}
