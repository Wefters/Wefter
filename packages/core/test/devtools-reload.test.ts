import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, ((data: unknown) => void)[]>();

vi.mock("../src/internal/devtools/emit.js", () => ({
  emitDevtoolsEvent: vi.fn(),
  onDevtoolsEvent: (event: string, cb: (data: unknown) => void) => {
    const existing = listeners.get(event) ?? [];
    existing.push(cb);
    listeners.set(event, existing);
  },
}));

const { installReloadListener } = await import("../src/internal/devtools/reload.js");

beforeEach(() => {
  listeners.clear();
});

describe("installReloadListener", () => {
  it("reloads when a wefter:reload event arrives", () => {
    const reload = vi.fn();
    installReloadListener(reload);

    expect(reload).not.toHaveBeenCalled();
    for (const cb of listeners.get("wefter:reload") ?? []) cb({});

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("subscribes to exactly the wefter:reload channel", () => {
    installReloadListener(vi.fn());
    expect([...listeners.keys()]).toEqual(["wefter:reload"]);
  });
});
