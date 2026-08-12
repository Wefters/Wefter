import { invokeNative } from "./native-bridge.js";

export function hideSplash(): Promise<void> {
  return invokeNative("__system", "hideSplash", {});
}
