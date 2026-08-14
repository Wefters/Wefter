import { beforeEach, describe, expect, it, vi } from "vitest";
import { definePlugin } from "../src/internal/define-plugin.js";

beforeEach(() => {
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
});

interface DeviceInfo {
  platform: string;
  osVersion: string;
}

describe("definePlugin", () => {
  it("prototyped against device-info's real shape — a zero-argument method is callable with no args, not forced to pass undefined", async () => {
    const nativeInvoke = vi.fn((callId: string, _plugin: string, _method: string, _payloadJson: string) => {
      window.__wefterNative.resolve(callId, JSON.stringify({ platform: "android", osVersion: "14" }));
    });
    window.AndroidBridge = { invoke: nativeInvoke };

    const Device = definePlugin<{ getInfo: () => Promise<DeviceInfo> }>("device-info", { getInfo: true });

    const result = await Device.getInfo();

    expect(result).toEqual({ platform: "android", osVersion: "14" });
    expect(nativeInvoke).toHaveBeenCalledWith(expect.any(String), "device-info", "getInfo", JSON.stringify({}));
  });

  it("a method taking a real payload dispatches it through unchanged", async () => {
    const nativeInvoke = vi.fn((callId: string, _plugin: string, _method: string, _payloadJson: string) => {
      window.__wefterNative.resolve(callId, JSON.stringify({ ok: true }));
    });
    window.AndroidBridge = { invoke: nativeInvoke };

    const Ping = definePlugin<{ ping: (payload: { message: string }) => Promise<{ ok: boolean }> }>("ping-test", {
      ping: true,
    });

    const result = await Ping.ping({ message: "hi" });

    expect(result).toEqual({ ok: true });
    expect(nativeInvoke).toHaveBeenCalledWith(
      expect.any(String),
      "ping-test",
      "ping",
      JSON.stringify({ message: "hi" }),
    );
  });

  it("produces a wrapper that fails the same way as a hand-written one when there's no bridge", async () => {
    const Device = definePlugin<{ getInfo: () => Promise<DeviceInfo> }>("device-info", { getInfo: true });

    await expect(Device.getInfo()).rejects.toThrow("No native bridge available");
  });
});
