/**
 * The JavaScript half of the bridge between the web app and native plugins.
 *
 * Calls go out through `window.AndroidBridge.invoke` on Android or the `WefterBridge` script message
 * handler on iOS. Native code answers by calling `window.__wefterNative.resolve` / `reject` with the
 * call id, and pushes events with `window.__wefterNative.emit`.
 */

import { WefterBridgeError } from "./errors.js";
import { tapBridgeCall, tapBridgeSettle, statusFromError } from "./devtools/bridge-tap.js";

/** Settles the promise of a call that is waiting for native code. */
type PendingCall = { resolve: (v: unknown) => void; reject: (r: unknown) => void };

/** Bridge state shared by every copy of this module in the page. */
interface BridgeState {
  pending: Map<string, PendingCall>;
  hooks: Map<string, Set<(data: unknown) => void>>;
  nextCallId: number;
  sessionId: string;
  /** Whether a copy of core already listens for held events arriving (see {@link takeHeldEvents}). */
  listensForHeldEvents?: boolean;
}

/**
 * Global key of the shared {@link BridgeState}. Keeping state on `globalThis` means two bundled copies
 * of core (or a hot-reloaded one) still resolve each other's calls.
 */
const BRIDGE_STATE_KEY = Symbol.for("wefter.bridge.state.v1");

/** Returns the shared bridge state, creating it on first use. */
function getBridgeState(): BridgeState {
  const holder = globalThis as unknown as Record<symbol, BridgeState | undefined>;
  return (holder[BRIDGE_STATE_KEY] ??= {
    pending: new Map(),
    hooks: new Map(),
    nextCallId: 0,
    sessionId: Math.random().toString(36).slice(2, 8) || "s",
  });
}

const { pending, hooks } = getBridgeState();

/** A call id unique to this page load: a random session prefix plus a counter. */
function nextCallId(): string {
  const state = getBridgeState();
  return `${state.sessionId}-${state.nextCallId++}`;
}

/** How long a call waits for native code before failing with `TIMEOUT`. */
const DEFAULT_TIMEOUT_MS = 10000;

declare global {
  /** Globals the native shells inject into the web view, and the callbacks they call back into. */
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

/**
 * The callbacks native code uses to settle calls and deliver hook events. Native errors arrive as JSON
 * and are turned into {@link WefterBridgeError}s.
 */
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

/** Whether the page is running inside a Wefter native shell. */
export function isNativeBridgeAvailable(): boolean {
  return typeof window !== "undefined" && (!!window.AndroidBridge || !!window.webkit?.messageHandlers?.WefterBridge);
}

/**
 * Resolves once the native bridge has been injected. Resolves immediately when it already is; in a
 * plain browser it never resolves.
 */
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

/**
 * Calls a method of a native plugin and resolves with its result.
 *
 * @param plugin Name of the native plugin.
 * @param method Name of the method on that plugin.
 * @param payload JSON-serialisable argument passed to the method.
 * @param options `signal` cancels the call; `timeoutMs` overrides the 10 second default.
 * @throws {WefterBridgeError} When the call times out, is aborted, no bridge is present, or native code
 * reports an error.
 */
export function invokeNative<T = unknown>(
  plugin: string,
  method: string,
  payload: unknown = {},
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<T> {
  const callId = nextCallId();
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

/**
 * Subscribes to events a native plugin pushes to JavaScript (for example a scan result or a network
 * change).
 *
 * Events a plugin held because they happened before anyone listened (a notification tap that launched
 * the app) are delivered to the first listener for that name, right after it registers.
 *
 * @returns A handle whose `remove()` unsubscribes the callback.
 */
export function registerHook(hookName: string, callback: (data: unknown) => void) {
  const listeners = hooks.get(hookName) ?? new Set();
  const isFirst = listeners.size === 0;
  listeners.add(callback);
  hooks.set(hookName, listeners);
  if (isFirst) takeHeldEvents(hookName);
  return { remove: () => hooks.get(hookName)?.delete(callback) };
}

/**
 * Takes the events the native side held under `hookName` and gives them to its listeners. Built-in
 * `__system` events are never held, and nothing happens outside a native app or with a shell that does
 * not hold events.
 */
function takeHeldEvents(hookName: string): void {
  if (hookName.startsWith("__") || !isNativeBridgeAvailable()) return;
  invokeNative<{ events?: unknown[] }>("__system", "takeEvents", { name: hookName }).then(
    (result) => {
      for (const event of result?.events ?? []) hooks.get(hookName)?.forEach((cb) => cb(event));
    },
    () => {},
  );
}

/** When the native side holds a new event, takes it if anyone listens for its name. Set up once per page. */
function listenForHeldEvents(): void {
  const state = getBridgeState();
  if (state.listensForHeldEvents) return;
  state.listensForHeldEvents = true;
  const listeners = hooks.get("__system:events") ?? new Set();
  listeners.add((data) => {
    const name = (data as { name?: unknown } | null)?.name;
    if (typeof name === "string" && (hooks.get(name)?.size ?? 0) > 0) takeHeldEvents(name);
  });
  hooks.set("__system:events", listeners);
}

if (typeof window !== "undefined") listenForHeldEvents();
