/** Reports bridge calls to the DevTools dashboard: one event when a call starts and one when it settles. */

import { emitDevtoolsEvent } from "./emit.js";
import { WefterBridgeError } from "../errors.js";

/** How a bridge call ended. */
export type BridgeStatus = "success" | "error" | "timeout" | "cancelled";

/** Announces a bridge call as it is sent to native code. */
export function tapBridgeCall(callId: string, plugin: string, method: string, args: unknown): void {
  emitDevtoolsEvent("wefter:bridge_call", { callId, plugin, method, args, timestamp: Date.now() });
}

/**
 * Announces how a bridge call ended, with its duration and either its result or its error. Errors are
 * reduced to their code, message and (when the native side sent one) native stack trace.
 */
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

/** Classifies a rejection: timeouts and aborts get their own status, everything else is an error. */
export function statusFromError(err: unknown): "error" | "timeout" | "cancelled" {
  if (err instanceof WefterBridgeError) {
    if (err.code === "TIMEOUT") return "timeout";
    if (err.code === "ABORTED") return "cancelled";
  }
  return "error";
}
