"use strict";
(() => {
  var WefterBridgeError = class extends Error {
    constructor(code, message) {
      super(message);
      this.name = "WefterBridgeError";
      this.code = code;
    }
  };

  var pending = new Map();
  var hooks = new Map();
  var callCounter = 0;
  var DEFAULT_TIMEOUT_MS = 1e4;
  if (typeof window !== "undefined") {
    window.__wefterNative = {
      resolve(callId, resultJson) {
        pending.get(callId)?.resolve(JSON.parse(resultJson));
        pending.delete(callId);
      },
      reject(callId, errorJson) {
        const parsed = JSON.parse(errorJson);
        const error =
          parsed !== null && typeof parsed === "object"
            ? new WefterBridgeError(
                "code" in parsed && typeof parsed.code === "string" ? parsed.code : "UNKNOWN",
                "message" in parsed && typeof parsed.message === "string" ? parsed.message : String(parsed),
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
  function invokeNative(plugin, method, payload = {}, options) {
    const callId = String(callCounter++);
    const signal = options?.signal;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new WefterBridgeError("ABORTED", "Call was aborted before it started"));
        return;
      }
      const onAbort = () => {
        pending.delete(callId);
        cleanup();
        reject(new WefterBridgeError("ABORTED", "Call was aborted"));
      };
      signal?.addEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        pending.delete(callId);
        cleanup();
        reject(new WefterBridgeError("TIMEOUT", `${plugin}.${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      pending.set(callId, {
        resolve: (v) => {
          cleanup();
          resolve(v);
        },
        reject: (r) => {
          cleanup();
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
        reject(new WefterBridgeError("NO_BRIDGE", "No native bridge available"));
      }
    });
  }
  function registerHook(hookName, callback) {
    if (!hooks.has(hookName)) hooks.set(hookName, new Set());
    hooks.get(hookName).add(callback);
    return { remove: () => hooks.get(hookName)?.delete(callback) };
  }

  var isDebugBuild = true;
  if (typeof window !== "undefined") {
    invokeNative("__system", "isDebug")
      .then((result) => {
        isDebugBuild = Boolean(result?.debug);
      })
      .catch(() => {});
  }
  var overlay = null;
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.setAttribute("data-wefter-error-overlay", "");
    overlay.style.cssText =
      "position:fixed;left:0;right:0;top:0;max-height:60%;overflow:auto;background:#3b0d0d;color:#ffdada;font:12px/1.4 monospace;padding:12px;white-space:pre-wrap;z-index:2147483647;";
    (document.body ?? document.documentElement).appendChild(overlay);
    return overlay;
  }
  function describeError(error) {
    if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  function reportUnhandledError(error) {
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

  window.Wefter = { invokeNative, registerHook };
})();
