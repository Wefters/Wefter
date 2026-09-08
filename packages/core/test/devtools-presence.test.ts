import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitDevtoolsEvent = vi.fn();
const listeners = new Map<string, ((data: unknown) => void)[]>();

vi.mock("../src/internal/devtools/emit.js", () => ({
  emitDevtoolsEvent: (...args: unknown[]) => emitDevtoolsEvent(...args),
  onDevtoolsEvent: (event: string, cb: (data: unknown) => void) => {
    const existing = listeners.get(event) ?? [];
    existing.push(cb);
    listeners.set(event, existing);
  },
}));

const { installPresence, __resetPresenceForTest } = await import("../src/internal/devtools/presence.js");

function fire(event: string, data?: unknown): void {
  for (const cb of listeners.get(event) ?? []) cb(data);
}

function helloEvents(): unknown[] {
  return emitDevtoolsEvent.mock.calls.filter(([name]) => name === "wefter:client_hello").map(([, payload]) => payload);
}

beforeEach(() => {
  vi.useFakeTimers();
  emitDevtoolsEvent.mockClear();
  listeners.clear();
  __resetPresenceForTest();
});

afterEach(() => {
  __resetPresenceForTest();
  vi.useRealTimers();
});

describe("installPresence", () => {
  it("announces a client_hello immediately with a stable id and the current url", () => {
    installPresence();

    const events = helloEvents() as { clientId: string; url: string; timestamp: number }[];
    expect(events).toHaveLength(1);
    expect(events[0].clientId).toEqual(expect.any(String));
    expect(events[0].url).toBe(location.href);
    expect(events[0].timestamp).toEqual(expect.any(Number));
  });

  it("keeps re-announcing on an interval until the server echoes our id back in a client list", () => {
    installPresence();
    const id = (helloEvents()[0] as { clientId: string }).clientId;

    vi.advanceTimersByTime(300 * 3);
    expect(helloEvents().length).toBe(4);

    fire("wefter:client_list", [{ clientId: id, url: "/", timestamp: 1 }]);

    vi.advanceTimersByTime(300 * 5);
    expect(helloEvents().length).toBe(4);
  });

  it("ignores a client list that does not contain our own id", () => {
    installPresence();

    fire("wefter:client_list", [{ clientId: "someone-else", url: "/", timestamp: 1 }]);
    vi.advanceTimersByTime(300);

    expect(helloEvents().length).toBe(2);
  });

  it("stops after a bounded number of attempts if it is never acknowledged", () => {
    installPresence();

    vi.advanceTimersByTime(300 * 50);

    expect(helloEvents().length).toBe(20);
  });

  it("re-announces from scratch when the HMR socket reconnects", () => {
    installPresence();
    const id = (helloEvents()[0] as { clientId: string }).clientId;
    fire("wefter:client_list", [{ clientId: id, url: "/", timestamp: 1 }]);
    emitDevtoolsEvent.mockClear();

    fire("vite:ws:connect");

    expect(helloEvents().length).toBe(1);
    vi.advanceTimersByTime(300 * 2);
    expect(helloEvents().length).toBe(3);
    expect((helloEvents()[0] as { clientId: string }).clientId).toBe(id);
  });
});
