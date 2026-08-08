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

  constructor(code: WefterErrorCode, message: string) {
    super(message);
    this.name = "WefterBridgeError";
    this.code = code;
  }
}
