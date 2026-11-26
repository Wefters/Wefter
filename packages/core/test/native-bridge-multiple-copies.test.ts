import { describe, expect, it, vi } from "vitest";

async function loadCopy() {
  vi.resetModules();
  return import("../src/internal/native-bridge.js");
}

describe("multiple copies of core in one page", () => {
  it("resolves calls made through every copy, whichever copy installed window.__wefterNative last", async () => {
    const copyA = await loadCopy();
    const copyB = await loadCopy(); // B's module ran last, so window.__wefterNative is B's

    const calls: { callId: string; plugin: string }[] = [];
    window.AndroidBridge = { invoke: (callId, plugin) => calls.push({ callId, plugin }) };

    const fromA = copyA.invokeNative("scanner", "scan");
    const fromB = copyB.invokeNative("device", "getInfo");

    expect(calls).toHaveLength(2);
    expect(calls[0]!.callId).not.toBe(calls[1]!.callId);

    window.__wefterNative.resolve(calls[1]!.callId, JSON.stringify({ from: "device" }));
    window.__wefterNative.resolve(calls[0]!.callId, JSON.stringify({ from: "scanner" }));

    await expect(fromA).resolves.toEqual({ from: "scanner" });
    await expect(fromB).resolves.toEqual({ from: "device" });
  });

  it("delivers native hook events to listeners registered through any copy", async () => {
    const copyA = await loadCopy();
    await loadCopy();

    const listener = vi.fn();
    copyA.registerHook("scanner:codeScanned", listener);
    window.__wefterNative.emit("scanner:codeScanned", JSON.stringify({ data: "abc" }));

    expect(listener).toHaveBeenCalledWith({ data: "abc" });
  });

  it("uses call ids that are unique across copies and safe to embed in a JS string literal", async () => {
    const copyA = await loadCopy();
    const copyB = await loadCopy();
    const ids: string[] = [];
    window.AndroidBridge = { invoke: (callId) => ids.push(callId) };

    for (let i = 0; i < 5; i++) {
      void copyA.invokeNative("a", "m").catch(() => {});
      void copyB.invokeNative("b", "m").catch(() => {});
    }

    expect(new Set(ids).size).toBe(10);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+-\d+$/);
  });
});
