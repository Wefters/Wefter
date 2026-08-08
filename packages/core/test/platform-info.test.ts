import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_PROTOCOL_VERSION, getPlatformInfo } from "../src/internal/platform-info.js";
import { CORE_VERSION } from "../src/internal/version.js";

beforeEach(() => {
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  delete (window as unknown as { webkit?: unknown }).webkit;
  delete (window as unknown as { __WEFTER_IOS_ENV__?: unknown }).__WEFTER_IOS_ENV__;
});

describe("getPlatformInfo", () => {
  it("reports platform 'web' and environment 'unknown' with no native bridge at all", () => {
    expect(getPlatformInfo()).toEqual({
      platform: "web",
      coreVersion: CORE_VERSION,
      environment: "unknown",
    });
  });

  it("reports platform 'android' and reads environment synchronously off the bridge, no round trip", () => {
    const getEnvironment = vi.fn(() => "production");
    window.AndroidBridge = { invoke: vi.fn(), getEnvironment };

    const info = getPlatformInfo();

    expect(info.platform).toBe("android");
    expect(info.environment).toBe("production");
    expect(getEnvironment).toHaveBeenCalledTimes(1);
  });

  it("falls back to 'unknown' when the bridge exists but predates getEnvironment()", () => {
    window.AndroidBridge = { invoke: vi.fn() };

    expect(getPlatformInfo().environment).toBe("unknown");
  });

  it("reports platform 'ios' when window.webkit.messageHandlers.WefterBridge is present", () => {
    window.webkit = { messageHandlers: { WefterBridge: { postMessage: vi.fn() } } };

    expect(getPlatformInfo().platform).toBe("ios");
  });

  it("reads iOS environment from the WKUserScript-injected global, not a synchronous bridge call", () => {
    window.webkit = { messageHandlers: { WefterBridge: { postMessage: vi.fn() } } };
    window.__WEFTER_IOS_ENV__ = "development";

    expect(getPlatformInfo().environment).toBe("development");
  });

  it("reports 'ios' platform with 'unknown' environment when the env global hasn't been injected yet", () => {
    window.webkit = { messageHandlers: { WefterBridge: { postMessage: vi.fn() } } };

    const info = getPlatformInfo();
    expect(info.platform).toBe("ios");
    expect(info.environment).toBe("unknown");
  });

  it("reports platform 'web' when window.webkit exists but has no WefterBridge handler", () => {
    window.webkit = { messageHandlers: {} };

    expect(getPlatformInfo().platform).toBe("web");
  });

  it("prefers 'android' over 'ios' when both bridges are somehow present", () => {
    window.AndroidBridge = { invoke: vi.fn(), getEnvironment: () => "production" };
    window.webkit = { messageHandlers: { WefterBridge: { postMessage: vi.fn() } } };

    expect(getPlatformInfo().platform).toBe("android");
  });
});

describe("CORE_PROTOCOL_VERSION", () => {
  it("is a stable positive integer", () => {
    expect(Number.isInteger(CORE_PROTOCOL_VERSION)).toBe(true);
    expect(CORE_PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
