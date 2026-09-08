import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLandscape } from "../src/internal/landscape.js";

beforeEach(() => {
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  delete (window as unknown as { webkit?: unknown }).webkit;
});

describe("isLandscape", () => {
  it("queries native bridge __system.isLandscape when bridge is available (returns true)", async () => {
    const nativeInvoke = vi.fn((callId: string) => {
      window.__wefterNative.resolve(callId, JSON.stringify({ landscape: true }));
    });
    window.AndroidBridge = { invoke: nativeInvoke };

    const result = await isLandscape();

    expect(nativeInvoke).toHaveBeenCalledWith(expect.any(String), "__system", "isLandscape", JSON.stringify({}));
    expect(result).toBe(true);
  });

  it("queries native bridge __system.isLandscape when bridge is available (returns false)", async () => {
    const nativeInvoke = vi.fn((callId: string) => {
      window.__wefterNative.resolve(callId, JSON.stringify({ landscape: false }));
    });
    window.AndroidBridge = { invoke: nativeInvoke };

    const result = await isLandscape();

    expect(nativeInvoke).toHaveBeenCalledWith(expect.any(String), "__system", "isLandscape", JSON.stringify({}));
    expect(result).toBe(false);
  });

  it("falls back to window.matchMedia on web when bridge is unavailable", async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(orientation: landscape)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const result = await isLandscape();
    expect(result).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(orientation: landscape)");
  });

  it("returns false on web when matchMedia indicates portrait", async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(orientation: landscape)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const result = await isLandscape();
    expect(result).toBe(false);
  });
});
