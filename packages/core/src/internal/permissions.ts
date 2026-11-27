import { invokeNative, isNativeBridgeAvailable } from "./native-bridge.js";
import { WefterBridgeError } from "./errors.js";

/**
 * Where a permission stands, as every plugin's `checkPermissions()` and `requestPermissions()` report it:
 *
 * - `granted`: the app may use it.
 * - `prompt`: asking shows the system prompt.
 * - `denied`: only the system settings can change it; see {@link openAppSettings}.
 * - `limited`: partly granted, such as the photos the user picked.
 */
export type PermissionState = "granted" | "prompt" | "denied" | "limited";

/** A plugin's permissions by the names it gives them, such as `{ camera: "granted" }`. */
export type PermissionStatus<Name extends string = string> = Record<Name, PermissionState>;

/**
 * Opens this app's page in the system settings, where the user can allow a permission they denied.
 *
 * @throws {WefterBridgeError} `NO_BRIDGE` outside a native app.
 */
export async function openAppSettings(): Promise<void> {
  if (!isNativeBridgeAvailable()) {
    throw new WefterBridgeError("NO_BRIDGE", "openAppSettings() only works inside a Wefter app");
  }
  await invokeNative("__system", "openAppSettings");
}
