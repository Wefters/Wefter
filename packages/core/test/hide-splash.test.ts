import { beforeEach, describe, expect, it, vi } from "vitest";
import { hideSplash } from "../src/internal/hide-splash.js";

beforeEach(() => {
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  delete (window as unknown as { webkit?: unknown }).webkit;
});

describe("hideSplash", () => {
  it("calls __system.hideSplash with no payload", async () => {
    const nativeInvoke = vi.fn((callId: string) => {
      window.__wefterNative.resolve(callId, JSON.stringify({}));
    });
    window.AndroidBridge = { invoke: nativeInvoke };

    await hideSplash();

    expect(nativeInvoke).toHaveBeenCalledWith(expect.any(String), "__system", "hideSplash", JSON.stringify({}));
  });
});
