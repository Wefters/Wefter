import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/client/store.js";

function flush(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("createStore", () => {
  it("get returns the initial state before any set", () => {
    const store = createStore({ count: 0 });
    expect(store.get()).toEqual({ count: 0 });
  });

  it("set updates state synchronously for a subsequent get", () => {
    const store = createStore(0);
    store.set((n) => n + 1);
    expect(store.get()).toBe(1);
  });

  it("does not notify subscribers synchronously — notification is batched to a frame", async () => {
    const store = createStore(0);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set((n) => n + 1);
    expect(listener).not.toHaveBeenCalled();

    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("coalesces multiple sets within the same frame into a single notification", async () => {
    const store = createStore(0);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set((n) => n + 1);
    store.set((n) => n + 1);
    store.set((n) => n + 1);

    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(3);
  });

  it("notifies every subscriber", async () => {
    const store = createStore(0);
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);

    store.set((n) => n + 1);
    await flush();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops future notifications", async () => {
    const store = createStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.set((n) => n + 1);
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it("schedules a fresh notification for a set that happens after the previous frame flushed", async () => {
    const store = createStore(0);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set((n) => n + 1);
    await flush();
    store.set((n) => n + 1);
    await flush();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(2);
  });
});
