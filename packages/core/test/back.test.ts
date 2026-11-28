import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockBridge, uninstallMockBridge } from "../src/testing.js";
import { onBack } from "../src/internal/back.js";

let calls: { method: string; payload: Record<string, unknown> }[];

function nativeBack(id: number, canGoBack = false) {
  window.__wefterNative.emit("__system:back", JSON.stringify({ id, source: "button", canGoBack }));
}

/** The `backResult` calls so far, after pending promises have settled. */
async function results() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  return calls.filter((c) => c.method === "backResult").map((c) => c.payload);
}

beforeEach(() => {
  calls = [];
  installMockBridge({
    __system: (method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return {};
    },
  });
});

afterEach(() => {
  uninstallMockBridge();
});

describe("onBack", () => {
  it("tells the app when the page starts and stops handling back", async () => {
    const offA = onBack(() => {});
    const offB = onBack(() => {});
    offA();
    offB();
    offB();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.filter((c) => c.method === "setBackListening").map((c) => c.payload)).toEqual([
      { listening: true },
      { listening: false },
    ]);
  });

  it("reports handled when a listener returns true, and passes the event", async () => {
    const seen: unknown[] = [];
    const offA = onBack((event) => {
      seen.push(event);
    });
    const offB = onBack(() => true);
    nativeBack(1, true);
    expect(await results()).toEqual([{ id: 1, handled: true }]);
    expect(seen).toEqual([{ source: "button", canGoBack: true }]);
    offA();
    offB();
  });

  it("asks for the default when no listener handles it, even when one throws", async () => {
    const offA = onBack(() => {
      throw new Error("boom");
    });
    const offB = onBack(() => false);
    const error = console.error;
    console.error = () => {};
    nativeBack(2);
    console.error = error;
    expect(await results()).toEqual([{ id: 2, handled: false }]);
    offA();
    offB();
  });

  it("reports a pending answer first when a listener returns a promise", async () => {
    let answer: (value: boolean) => void = () => {};
    const off = onBack(() => new Promise<boolean>((resolve) => (answer = resolve)));
    nativeBack(3);
    expect(await results()).toEqual([{ id: 3, pending: true }]);
    answer(true);
    expect(await results()).toEqual([
      { id: 3, pending: true },
      { id: 3, handled: true },
    ]);
    off();
  });

  it("treats a rejected promise as not handled", async () => {
    const off = onBack(() => Promise.reject(new Error("no")));
    nativeBack(4);
    await results();
    expect(await results()).toEqual([
      { id: 4, pending: true },
      { id: 4, handled: false },
    ]);
    off();
  });
});
