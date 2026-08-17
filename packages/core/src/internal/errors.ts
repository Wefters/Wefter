export type WefterErrorCode =
  | "TIMEOUT"
  | "ABORTED"
  | "NO_BRIDGE"
  | "UNKNOWN_PLUGIN"
  | "INVALID_PAYLOAD"
  | "PLUGIN_THREW"
  | "PERMISSION_DENIED"
  | "UNKNOWN";

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
