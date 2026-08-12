import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDeviceInfo } from "../src/internal/device-info.js";

beforeEach(() => {
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  delete (window as unknown as { webkit?: unknown }).webkit;
});

describe("getDeviceInfo", () => {
  it("calls __system.getDeviceInfo with no payload", async () => {
    const nativeInvoke = vi.fn((callId: string) => {
      window.__wefterNative.resolve(callId, JSON.stringify({ platform: "android", osVersion: "14" }));
    });
    window.AndroidBridge = { invoke: nativeInvoke };

    await getDeviceInfo();

    expect(nativeInvoke).toHaveBeenCalledWith(expect.any(String), "__system", "getDeviceInfo", JSON.stringify({}));
  });

  it("resolves with the platform and osVersion the native side returns", async () => {
    const nativeInvoke = vi.fn((callId: string) => {
      window.__wefterNative.resolve(callId, JSON.stringify({ platform: "ios", osVersion: "17.4" }));
    });
    window.AndroidBridge = { invoke: nativeInvoke };

    const info = await getDeviceInfo();

    expect(info).toEqual({ platform: "ios", osVersion: "17.4" });
  });
});
