import { invokeNative, isNativeBridgeAvailable } from "./native-bridge.js";

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
