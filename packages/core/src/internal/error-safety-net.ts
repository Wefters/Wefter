import { invokeNative } from "./native-bridge.js";

let isDebugBuild = true;

if (typeof window !== "undefined") {
  invokeNative("__system", "isDebug")
    .then((result) => {
      isDebugBuild = Boolean((result as { debug?: boolean } | null)?.debug);
    })
    .catch(() => {
    });
}

export function __setDebugBuildForTest(value: boolean): void {
  isDebugBuild = value;
}
export function __resetOverlayForTest(): void {
  overlay?.remove();
  overlay = null;
}

let overlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.setAttribute("data-wefter-error-overlay", "");
  overlay.style.cssText =
    "position:fixed;left:0;right:0;top:0;max-height:60%;overflow:auto;" +
    "background:#3b0d0d;color:#ffdada;font:12px/1.4 monospace;" +
    "padding:12px;white-space:pre-wrap;z-index:2147483647;";
  (document.body ?? document.documentElement).appendChild(overlay);
  return overlay;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function reportUnhandledError(error: unknown): void {
  if (isDebugBuild) {
    const el = ensureOverlay();
    const entry = document.createElement("div");
    entry.style.cssText = "border-top:1px solid #ffdada44;padding-top:8px;margin-top:8px;";
    entry.textContent = describeError(error);
    el.appendChild(entry);
  } else {
    console.error("[wefter] unhandled error", error);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => reportUnhandledError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => reportUnhandledError(event.reason));
}
