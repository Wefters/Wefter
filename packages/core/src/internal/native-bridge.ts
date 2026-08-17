import { WefterBridgeError } from "./errors.js";
import { tapBridgeCall, tapBridgeSettle, statusFromError } from "./devtools/bridge-tap.js";

type PendingCall = { resolve: (v: unknown) => void; reject: (r: unknown) => void };

const pending = new Map<string, PendingCall>();
const hooks = new Map<string, Set<(data: unknown) => void>>();
let callCounter = 0;

const DEFAULT_TIMEOUT_MS = 10000;

declare global {
  interface Window {
    AndroidBridge?: {
      invoke(callId: string, plugin: string, method: string, payloadJson: string): void;
      getEnvironment?(): string;
    };
    webkit?: {
      messageHandlers?: {
        WefterBridge?: {
          postMessage(message: { callId: string; plugin: string; method: string; payload: unknown }): void;
        };
      };
    };

    __WEFTER_IOS_ENV__?: string;
    __wefterNative: {
      resolve(callId: string, resultJson: string): void;
      reject(callId: string, errorJson: string): void;
      emit(hookName: string, dataJson: string): void;
    };
  }
}

if (typeof window !== "undefined") {
  window.__wefterNative = {
    resolve(callId, resultJson) {
      pending.get(callId)?.resolve(JSON.parse(resultJson));
      pending.delete(callId);
    },
    reject(callId, errorJson) {
      const parsed: unknown = JSON.parse(errorJson);
      const error =
        parsed !== null && typeof parsed === "object"
          ? new WefterBridgeError(
              "code" in parsed && typeof (parsed as { code?: unknown }).code === "string"
                ? ((parsed as { code: string }).code as WefterBridgeError["code"])
                : "UNKNOWN",
              "message" in parsed && typeof (parsed as { message?: unknown }).message === "string"
                ? (parsed as { message: string }).message
                : String(parsed),
              "nativeStack" in parsed && typeof (parsed as { nativeStack?: unknown }).nativeStack === "string"
                ? (parsed as { nativeStack: string }).nativeStack
                : undefined,
            )
          : new WefterBridgeError("UNKNOWN", String(parsed));
      pending.get(callId)?.reject(error);
      pending.delete(callId);
    },
    emit(hookName, dataJson) {
      const data = JSON.parse(dataJson);
      hooks.get(hookName)?.forEach((cb) => cb(data));
    },
  };
}

export function isNativeBridgeAvailable(): boolean {
  return typeof window !== "undefined" && (!!window.AndroidBridge || !!window.webkit?.messageHandlers?.WefterBridge);
}

export function onBridgeReady(): Promise<void> {
  if (isNativeBridgeAvailable()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (isNativeBridgeAvailable()) resolve();
      else setTimeout(check, 20);
    };
    check();
  });
}

export function invokeNative<T = unknown>(
  plugin: string,
  method: string,
  payload: unknown = {},
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<T> {
  const callId = String(callCounter++);
  const signal = options?.signal;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (import.meta.hot) tapBridgeCall(callId, plugin, method, payload);
  const startedAt = Date.now();

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      const error = new WefterBridgeError("ABORTED", "Call was aborted before it started");
      if (import.meta.hot) tapBridgeSettle(callId, "cancelled", startedAt, { error });
      reject(error);
      return;
    }

    const onAbort = () => {
      pending.delete(callId);
      cleanup();
      const error = new WefterBridgeError("ABORTED", "Call was aborted");
      if (import.meta.hot) tapBridgeSettle(callId, "cancelled", startedAt, { error });
      reject(error);
    };
    signal?.addEventListener("abort", onAbort);

    const timer = setTimeout(() => {
      pending.delete(callId);
      cleanup();
      const error = new WefterBridgeError("TIMEOUT", `${plugin}.${method} timed out after ${timeoutMs}ms`);
      if (import.meta.hot) tapBridgeSettle(callId, "timeout", startedAt, { error });
      reject(error);
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    pending.set(callId, {
      resolve: (v) => {
        cleanup();
        if (import.meta.hot) tapBridgeSettle(callId, "success", startedAt, { result: v });
        resolve(v as T);
      },
      reject: (r) => {
        cleanup();
        if (import.meta.hot) tapBridgeSettle(callId, statusFromError(r), startedAt, { error: r });
        reject(r);
      },
    });

    if (window.AndroidBridge) {
      window.AndroidBridge.invoke(callId, plugin, method, JSON.stringify(payload));
    } else if (window.webkit?.messageHandlers?.WefterBridge) {
      window.webkit.messageHandlers.WefterBridge.postMessage({ callId, plugin, method, payload });
    } else {
      pending.delete(callId);
      cleanup();
      const error = new WefterBridgeError("NO_BRIDGE", "No native bridge available");
      if (import.meta.hot) tapBridgeSettle(callId, "error", startedAt, { error });
      reject(error);
    }
  });
}

export function registerHook(hookName: string, callback: (data: unknown) => void) {
  if (!hooks.has(hookName)) hooks.set(hookName, new Set());
  hooks.get(hookName)!.add(callback);
  return { remove: () => hooks.get(hookName)?.delete(callback) };
}
