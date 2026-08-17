import { emitDevtoolsEvent } from "./emit.js";
import { WefterBridgeError } from "../errors.js";

export type BridgeStatus = "success" | "error" | "timeout" | "cancelled";

export function tapBridgeCall(callId: string, plugin: string, method: string, args: unknown): void {
  emitDevtoolsEvent("wefter:bridge_call", { callId, plugin, method, args, timestamp: Date.now() });
}

export function tapBridgeSettle(
  callId: string,
  status: BridgeStatus,
  startedAt: number,
  outcome: { result: unknown } | { error: unknown },
): void {
  const durationMs = Date.now() - startedAt;
  if ("result" in outcome) {
    emitDevtoolsEvent("wefter:bridge_response", { callId, status, result: outcome.result, durationMs });
    return;
  }
  const err = outcome.error;
  const code = err instanceof WefterBridgeError ? err.code : "UNKNOWN";
  const message = err instanceof Error ? err.message : String(err);
  const nativeStack = err instanceof WefterBridgeError ? err.nativeStack : undefined;
  emitDevtoolsEvent("wefter:bridge_response", {
    callId,
    status,
    error: nativeStack ? { code, message, nativeStack } : { code, message },
    durationMs,
  });
}

export function statusFromError(err: unknown): "error" | "timeout" | "cancelled" {
  if (err instanceof WefterBridgeError) {
    if (err.code === "TIMEOUT") return "timeout";
    if (err.code === "ABORTED") return "cancelled";
  }
  return "error";
}
