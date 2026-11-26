/**
 * Why a bridge call failed.
 *
 * - `TIMEOUT`: native code did not answer in time.
 * - `ABORTED`: the caller's `AbortSignal` fired.
 * - `NO_BRIDGE`: not running inside a Wefter shell.
 * - `UNKNOWN_PLUGIN`: no plugin is registered under that name.
 * - `INVALID_PAYLOAD`: the payload did not match what the method expects.
 * - `PLUGIN_THREW`: the native method threw.
 * - `PERMISSION_DENIED`: the user or OS refused a permission the method needs.
 * - `UNKNOWN`: anything else.
 */
export type WefterErrorCode =
  | "TIMEOUT"
  | "ABORTED"
  | "NO_BRIDGE"
  | "UNKNOWN_PLUGIN"
  | "INVALID_PAYLOAD"
  | "PLUGIN_THREW"
  | "PERMISSION_DENIED"
  | "UNKNOWN";

/**
 * Error thrown by every failed bridge call. `code` says why, and `nativeStack` carries the native stack
 * trace in debug builds.
 */
export class WefterBridgeError extends Error {
  readonly code: WefterErrorCode;
  readonly nativeStack?: string;

  constructor(code: WefterErrorCode, message: string, nativeStack?: string) {
    super(message);
    this.name = "WefterBridgeError";
    this.code = code;
    this.nativeStack = nativeStack;
  }
}
