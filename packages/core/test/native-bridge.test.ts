import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invokeNative,
  isNativeBridgeAvailable,
  onBridgeReady,
  registerHook,
} from "../src/internal/native-bridge.js";
import { WefterBridgeError } from "../src/internal/errors.js";

beforeEach(() => {
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  delete (window as unknown as { webkit?: unknown }).webkit;
  delete (window as unknown as { __WEFTER_IOS_ENV__?: unknown }).__WEFTER_IOS_ENV__;
});

function installMockWebkitBridge(postMessage: (message: unknown) => void) {
  window.webkit = { messageHandlers: { WefterBridge: { postMessage } } };
}

describe("invokeNative", () => {
  it("resolves when the native side calls __wefterNative.resolve() with the matching call id", async () => {
    const nativeInvoke = vi.fn(
      (callId: string, _plugin: string, _method: string, _payloadJson: string) => {
        window.__wefterNative.resolve(callId, JSON.stringify({ ok: true }));
      }
    );
    window.AndroidBridge = { invoke: nativeInvoke };

    const result = await invokeNative("device", "getInfo", {});

    expect(result).toEqual({ ok: true });
    expect(nativeInvoke).toHaveBeenCalledWith(
      expect.any(String),
      "device",
      "getInfo",
      JSON.stringify({})
    );
  });

  it("rejects with a WefterBridgeError built from the native side's {code, message} payload", async () => {
    window.AndroidBridge = {
      invoke: (callId) => {
        window.__wefterNative.reject(callId, JSON.stringify({ code: "PLUGIN_THREW", message: "boom" }));
      },
    };

    const promise = invokeNative("device", "getInfo", {});
    await expect(promise).rejects.toBeInstanceOf(WefterBridgeError);
    await expect(promise).rejects.toMatchObject({ code: "PLUGIN_THREW", message: "boom" });
  });

  it("defaults to code UNKNOWN when the native side sends a payload with no code", async () => {
    window.AndroidBridge = {
      invoke: (callId) => {
        window.__wefterNative.reject(callId, JSON.stringify({ message: "boom" }));
      },
    };

    await expect(invokeNative("device", "getInfo", {})).rejects.toMatchObject({
      code: "UNKNOWN",
      message: "boom",
    });
  });

  it("rejects immediately when no native bridge is available", async () => {
    const promise = invokeNative("device", "getInfo", {});
    await expect(promise).rejects.toThrow("No native bridge available");
    await expect(promise).rejects.toBeInstanceOf(WefterBridgeError);
  });
});

describe("invokeNative on iOS (window.webkit.messageHandlers.WefterBridge)", () => {
  it("posts {callId, plugin, method, payload} as a plain object, not a JSON string", async () => {
    const postMessage = vi.fn((message: { callId: string; plugin: string; method: string; payload: unknown }) => {
      window.__wefterNative.resolve(message.callId, JSON.stringify({ ok: true }));
    });
    installMockWebkitBridge(postMessage);

    const result = await invokeNative("device", "getInfo", { foo: "bar" });

    expect(result).toEqual({ ok: true });
    expect(postMessage).toHaveBeenCalledWith({
      callId: expect.any(String),
      plugin: "device",
      method: "getInfo",
      payload: { foo: "bar" },
    });
  });

  it("rejects with a WefterBridgeError built from the native side's {code, message} payload", async () => {
    installMockWebkitBridge((message) => {
      const { callId } = message as { callId: string };
      window.__wefterNative.reject(callId, JSON.stringify({ code: "PLUGIN_THREW", message: "boom" }));
    });

    const promise = invokeNative("device", "getInfo", {});
    await expect(promise).rejects.toBeInstanceOf(WefterBridgeError);
    await expect(promise).rejects.toMatchObject({ code: "PLUGIN_THREW", message: "boom" });
  });

  it("times out the same way the Android path does when the native side never responds", async () => {
    vi.useFakeTimers();
    installMockWebkitBridge(vi.fn());

    const promise = invokeNative("device", "getInfo", {}, { timeoutMs: 500 });
    const assertion = expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });

    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    vi.useRealTimers();
  });

  it("prefers window.AndroidBridge when both bridges are somehow present", async () => {
    const androidInvoke = vi.fn((callId: string) => window.__wefterNative.resolve(callId, JSON.stringify("android")));
    const webkitPostMessage = vi.fn();
    window.AndroidBridge = { invoke: androidInvoke };
    installMockWebkitBridge(webkitPostMessage);

    const result = await invokeNative("device", "getInfo", {});

    expect(result).toBe("android");
    expect(androidInvoke).toHaveBeenCalledTimes(1);
    expect(webkitPostMessage).not.toHaveBeenCalled();
  });
});

describe("invokeNative timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with a TIMEOUT error once the default timeout elapses without a response", async () => {
    window.AndroidBridge = { invoke: vi.fn() };

    const promise = invokeNative("device", "getInfo", {});
    const assertion = expect(promise).rejects.toBeInstanceOf(WefterBridgeError);

    await vi.advanceTimersByTimeAsync(10000);

    await assertion;
    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("respects a custom timeoutMs", async () => {
    window.AndroidBridge = { invoke: vi.fn() };

    const promise = invokeNative("device", "getInfo", {}, { timeoutMs: 500 });
    const assertion = expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });

    await vi.advanceTimersByTimeAsync(500);

    await assertion;
  });

  it("does not time out once the native side resolves in time", async () => {
    window.AndroidBridge = {
      invoke: (callId) => window.__wefterNative.resolve(callId, JSON.stringify({ ok: true })),
    };

    const result = await invokeNative("device", "getInfo", {}, { timeoutMs: 500 });

    expect(result).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(600);
  });
});

describe("isNativeBridgeAvailable", () => {
  it("is false with no bridge installed", () => {
    expect(isNativeBridgeAvailable()).toBe(false);
  });

  it("is true once window.AndroidBridge is set", () => {
    window.AndroidBridge = { invoke: vi.fn() };
    expect(isNativeBridgeAvailable()).toBe(true);
  });

  it("is true once window.webkit.messageHandlers.WefterBridge is set", () => {
    installMockWebkitBridge(vi.fn());
    expect(isNativeBridgeAvailable()).toBe(true);
  });

  it("is false when window.webkit exists but has no WefterBridge message handler", () => {
    window.webkit = { messageHandlers: {} };
    expect(isNativeBridgeAvailable()).toBe(false);
  });
});

describe("onBridgeReady", () => {
  it("resolves immediately when the bridge is already available (called after)", async () => {
    window.AndroidBridge = { invoke: vi.fn() };

    await expect(onBridgeReady()).resolves.toBeUndefined();
  });

  it("resolves once the bridge shows up later (called before)", async () => {
    const promise = onBridgeReady();

    await new Promise((r) => setTimeout(r, 45));
    window.AndroidBridge = { invoke: vi.fn() };

    await expect(promise).resolves.toBeUndefined();
  });
});

describe("invokeNative cancellation via AbortSignal", () => {
  it("rejects immediately without dispatching when the signal is already aborted", async () => {
    const nativeInvoke = vi.fn();
    window.AndroidBridge = { invoke: nativeInvoke };
    const controller = new AbortController();
    controller.abort();

    const promise = invokeNative("device", "getInfo", {}, { signal: controller.signal });

    await expect(promise).rejects.toThrow("Call was aborted before it started");
    await expect(promise).rejects.toBeInstanceOf(WefterBridgeError);
    expect(nativeInvoke).not.toHaveBeenCalled();
  });

  it("rejects a call aborted mid-flight, before the native side ever responds", async () => {
    window.AndroidBridge = { invoke: vi.fn() };
    const controller = new AbortController();

    const promise = invokeNative("device", "getInfo", {}, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow("Call was aborted");
    await expect(promise).rejects.toBeInstanceOf(WefterBridgeError);
  });

  it("aborting after the call already resolved is a harmless no-op, not an error", async () => {
    const controller = new AbortController();
    window.AndroidBridge = {
      invoke: (callId) => window.__wefterNative.resolve(callId, JSON.stringify({ ok: true })),
    };

    const result = await invokeNative("device", "getInfo", {}, { signal: controller.signal });
    expect(() => controller.abort()).not.toThrow();
    expect(result).toEqual({ ok: true });
  });
});

describe("registerHook", () => {
  it("fans out an emitted hook to every listener, lifecycle and plugin namespaces alike", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerHook("onResume", a);
    registerHook("scanner:result", b);

    window.__wefterNative.emit("onResume", JSON.stringify({}));
    window.__wefterNative.emit("scanner:result", JSON.stringify({ code: "123" }));

    expect(a).toHaveBeenCalledWith({});
    expect(b).toHaveBeenCalledWith({ code: "123" });
  });

  it("stops calling a listener after remove() is invoked", () => {
    const cb = vi.fn();
    const subscription = registerHook("scanner:result", cb);
    subscription.remove();

    window.__wefterNative.emit("scanner:result", JSON.stringify({ code: "456" }));

    expect(cb).not.toHaveBeenCalled();
  });
});
