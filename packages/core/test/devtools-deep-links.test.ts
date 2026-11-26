import { beforeEach, describe, expect, it, vi } from "vitest";

const emitDevtoolsEvent = vi.fn();
const listeners = new Map<string, ((data: unknown) => void)[]>();
vi.mock("../src/internal/devtools/emit.js", () => ({
  emitDevtoolsEvent: (...args: unknown[]) => emitDevtoolsEvent(...args),
  onDevtoolsEvent: (event: string, cb: (data: unknown) => void) => {
    listeners.set(event, [...(listeners.get(event) ?? []), cb]);
  },
}));

const { onDeepLink, simulateDeepLink } = await import("../src/internal/deep-links.js");

/** Payloads of the emitted events called `name`. */
function emitted(name: string): unknown[] {
  return emitDevtoolsEvent.mock.calls.filter(([event]) => event === name).map(([, payload]) => payload);
}

/** Lets pending bridge calls settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  emitDevtoolsEvent.mockClear();
  const state = (globalThis as Record<symbol, { listeners: Set<unknown> } | undefined>)[
    Symbol.for("wefter.deepLinks.state.v1")
  ];
  state?.listeners.clear();
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
});

describe("deep link DevTools instrumentation", () => {
  it("reports the listener count as listeners subscribe and unsubscribe", () => {
    const first = onDeepLink(vi.fn());
    const second = onDeepLink(vi.fn());
    first.remove();
    second.remove();

    expect(emitted("wefter:deep_link_listeners").map((e) => (e as { listeners: number }).listeners)).toEqual([
      1, 2, 1, 0,
    ]);
  });

  it("reports each link the shell delivers, with how many listeners got it", async () => {
    window.AndroidBridge = {
      invoke: (callId: string, _plugin: string, method: string) => {
        const links = method === "takeDeepLinks" ? [{ url: "myshop://product/42?ref=mail", isLaunch: true }] : [];
        queueMicrotask(() => window.__wefterNative.resolve(callId, JSON.stringify({ links })));
      },
    };

    onDeepLink(vi.fn());
    await settle();

    expect(emitted("wefter:deep_link")).toEqual([
      {
        url: "myshop://product/42?ref=mail",
        scheme: "myshop",
        path: "/product/42",
        query: { ref: "mail" },
        isLaunch: true,
        source: "native",
        listeners: 1,
        timestamp: expect.any(Number),
      },
    ]);
  });

  it("delivers a link sent from the dashboard to the listeners and reports it as from DevTools", () => {
    const listener = vi.fn();
    onDeepLink(listener);

    for (const cb of listeners.get("wefter:simulate_deep_link") ?? []) cb({ url: "myshop://cart" });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ path: "/cart", isLaunch: false }));
    expect(emitted("wefter:deep_link")).toContainEqual(
      expect.objectContaining({ url: "myshop://cart", source: "devtools", listeners: 1 }),
    );
  });

  it("reports a link that cannot be parsed as reaching no listener", () => {
    const listener = vi.fn();
    onDeepLink(listener);

    simulateDeepLink("not a url");

    expect(listener).not.toHaveBeenCalled();
    expect(emitted("wefter:deep_link")).toContainEqual(
      expect.objectContaining({ url: "not a url", scheme: null, path: null, listeners: 0 }),
    );
  });

  it("reports the listener count again after reconnecting to the dev server", () => {
    onDeepLink(vi.fn());
    emitDevtoolsEvent.mockClear();

    for (const cb of listeners.get("vite:ws:connect") ?? []) cb(undefined);

    expect(emitted("wefter:deep_link_listeners")).toEqual([{ listeners: 1, timestamp: expect.any(Number) }]);
  });
});
