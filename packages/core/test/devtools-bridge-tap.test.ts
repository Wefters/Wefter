import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitDevtoolsEvent = vi.fn();
vi.mock("../src/internal/devtools/emit.js", () => ({
  emitDevtoolsEvent: (...args: unknown[]) => emitDevtoolsEvent(...args),
  onDevtoolsEvent: vi.fn(),
}));

const { invokeNative } = await import("../src/internal/native-bridge.js");
const { WefterBridgeError } = await import("../src/internal/errors.js");

beforeEach(() => {
  emitDevtoolsEvent.mockClear();
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  delete (window as unknown as { webkit?: unknown }).webkit;
});

function callEvents(): unknown[][] {
  return emitDevtoolsEvent.mock.calls.filter(([name]) => name === "wefter:bridge_call");
}
function responseEvents(): unknown[][] {
  return emitDevtoolsEvent.mock.calls.filter(([name]) => name === "wefter:bridge_response");
}

describe("bridge instrumentation — success", () => {
  it("emits a matching call + response pair with status success", async () => {
    window.AndroidBridge = {
      invoke: (callId: string) => window.__wefterNative.resolve(callId, JSON.stringify({ ok: true })),
    };

    await invokeNative("haptics", "vibrate", { intensity: "light" });

    expect(callEvents()).toHaveLength(1);
    const [, callPayload] = callEvents()[0];
    expect(callPayload).toMatchObject({
      method: "vibrate",
      plugin: "haptics",
      args: { intensity: "light" },
    });
    expect((callPayload as { callId: string; timestamp: number }).callId).toEqual(expect.any(String));
    expect((callPayload as { callId: string; timestamp: number }).timestamp).toEqual(expect.any(Number));

    expect(responseEvents()).toHaveLength(1);
    const [, responsePayload] = responseEvents()[0];
    expect(responsePayload).toMatchObject({
      callId: (callPayload as { callId: string }).callId,
      status: "success",
      result: { ok: true },
    });
    expect((responsePayload as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("bridge instrumentation — error", () => {
  it("emits status error with the native {code, message} when the plugin rejects", async () => {
    window.AndroidBridge = {
      invoke: (callId: string) =>
        window.__wefterNative.reject(callId, JSON.stringify({ code: "PLUGIN_THREW", message: "boom" })),
    };

    await expect(invokeNative("scanner", "scan", {})).rejects.toBeInstanceOf(WefterBridgeError);

    expect(responseEvents()).toHaveLength(1);
    const [, responsePayload] = responseEvents()[0];
    expect(responsePayload).toMatchObject({
      status: "error",
      error: { code: "PLUGIN_THREW", message: "boom" },
    });
  });

  it("includes nativeStack in the emitted error object when the native side sent one", async () => {
    window.AndroidBridge = {
      invoke: (callId: string) =>
        window.__wefterNative.reject(
          callId,
          JSON.stringify({ code: "PLUGIN_THREW", message: "boom", nativeStack: "java.lang.RuntimeException: boom" }),
        ),
    };

    await expect(invokeNative("error-test", "throwRuntime", {})).rejects.toBeInstanceOf(WefterBridgeError);

    const [, responsePayload] = responseEvents()[0];
    expect(responsePayload).toMatchObject({
      error: { code: "PLUGIN_THREW", message: "boom", nativeStack: "java.lang.RuntimeException: boom" },
    });
  });

  it("omits nativeStack from the emitted error object entirely when the native side didn't send one", async () => {
    window.AndroidBridge = {
      invoke: (callId: string) =>
        window.__wefterNative.reject(callId, JSON.stringify({ code: "NO_MOCK_HANDLER", message: "nope" })),
    };

    await expect(invokeNative("device", "getInfo", {})).rejects.toBeInstanceOf(WefterBridgeError);

    const [, responsePayload] = responseEvents()[0];
    const errorPayload = (responsePayload as { error: object }).error;
    expect(errorPayload).not.toHaveProperty("nativeStack");
  });

  it("emits status error immediately when no native bridge is available (no pending map involved)", async () => {
    await expect(invokeNative("device", "getInfo", {})).rejects.toBeInstanceOf(WefterBridgeError);

    expect(callEvents()).toHaveLength(1);
    expect(responseEvents()).toHaveLength(1);
    const [, responsePayload] = responseEvents()[0];
    expect(responsePayload).toMatchObject({ status: "error", error: { code: "NO_BRIDGE" } });
  });
});

describe("bridge instrumentation — timeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits status timeout via the setTimeout settle path, not just the pending-map wrapper", async () => {
    window.AndroidBridge = { invoke: vi.fn() };

    const promise = invokeNative("device", "getInfo", {}, { timeoutMs: 500 });
    const assertion = expect(promise).rejects.toBeInstanceOf(WefterBridgeError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;

    expect(responseEvents()).toHaveLength(1);
    const [, responsePayload] = responseEvents()[0];
    expect(responsePayload).toMatchObject({ status: "timeout" });
  });
});

describe("bridge instrumentation — cancelled", () => {
  it("emits status cancelled when aborted mid-flight via the onAbort settle path", async () => {
    window.AndroidBridge = { invoke: vi.fn() };
    const controller = new AbortController();

    const promise = invokeNative("device", "getInfo", {}, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(WefterBridgeError);

    expect(responseEvents()).toHaveLength(1);
    const [, responsePayload] = responseEvents()[0];
    expect(responsePayload).toMatchObject({ status: "cancelled" });
  });

  it("emits status cancelled when the signal is already aborted before the call starts", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(invokeNative("device", "getInfo", {}, { signal: controller.signal })).rejects.toBeInstanceOf(
      WefterBridgeError,
    );

    expect(callEvents()).toHaveLength(1);
    expect(responseEvents()).toHaveLength(1);
    const [, responsePayload] = responseEvents()[0];
    expect(responsePayload).toMatchObject({ status: "cancelled" });
  });
});
