import { invokeNative, isNativeBridgeAvailable, registerHook } from "./native-bridge.js";

/** A back request: the Android back button or gesture, or the iOS edge swipe when `swipeBack` is `"page"`. */
export interface BackEvent {
  /** `"button"`: Android's back button (or a gesture the system doesn't report as one); `"gesture"`: a swipe. */
  source: "button" | "gesture";
  /** The screen edge a gesture started from, when the system reports it (Android 14+, the iOS swipe). */
  edge?: "left" | "right";
  /** Whether the web view has a page to go back to, which the default action would do. */
  canGoBack: boolean;
}

/**
 * Handles a back request. Return `true` (or a promise of `true`) when the page handled it; anything else
 * lets the app do the default: go back in history, or on Android leave the app.
 */
export type BackListener = (event: BackEvent) => boolean | void | Promise<boolean | void>;

interface NativeBackEvent extends BackEvent {
  id: number;
}

const listeners = new Set<BackListener>();
let hook: { remove: () => void } | undefined;

/** Tells the native side whether the page handles back requests. */
function setListening(listening: boolean): void {
  if (!isNativeBridgeAvailable()) return;
  invokeNative("__system", "setBackListening", { listening }).catch(() => {});
}

function report(id: number, result: { handled?: boolean; pending?: boolean }): void {
  invokeNative("__system", "backResult", { id, ...result }).catch(() => {});
}

/** Runs the listeners for a back request and tells the native side whether one handled it. */
function onNativeBack(data: unknown): void {
  const { id, ...event } = data as NativeBackEvent;
  const results: unknown[] = [];
  for (const listener of [...listeners]) {
    try {
      results.push(listener(event));
    } catch (error) {
      console.error(error);
    }
  }
  if (results.some((result) => result === true)) return report(id, { handled: true });
  const pending = results.filter((result): result is Promise<unknown> => result instanceof Promise);
  if (pending.length === 0) return report(id, { handled: false });

  // A listener is still deciding (a "Quit?" dialog): the app waits for it instead of timing out.
  report(id, { pending: true });
  Promise.allSettled(pending).then((settled) => {
    const handled = settled.some((result) => result.status === "fulfilled" && result.value === true);
    report(id, { handled });
  });
}

/**
 * Handles back requests in the page: the Android back button and back gesture, and on iOS the edge swipe
 * when `gestures.swipeBack` is `"page"`. While at least one listener is registered the page decides; a
 * listener returns `true` (or a promise of `true`) when it handled the request, and otherwise the app does
 * the default: close fullscreen video or an open web window first (those never reach the page), then go
 * back in history, then on Android leave the app. If the page doesn't answer within two seconds (it froze),
 * the app does the default.
 *
 * Without listeners the app does the default by itself, so back always works.
 *
 * @returns A function that removes the listener.
 *
 * @example
 * const off = onBack(async () => {
 *   if (menu.open) { menu.close(); return true; }
 *   if (playing) return await confirmQuit();
 * });
 */
export function onBack(listener: BackListener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    hook ??= registerHook("__system:back", onNativeBack);
    setListening(true);
  }
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    setListening(false);
  };
}
