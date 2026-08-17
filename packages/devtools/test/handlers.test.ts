import { describe, expect, it, vi } from "vitest";
import type { NormalizedHotChannelClient, ViteDevServer } from "vite";
import { createDevtoolsState, registerServerHandlers } from "../src/server/handlers.js";
import { WEFTER_EVENT } from "../src/shared/events.js";

type Handler = (data: unknown, client: unknown) => void;

function createFakeServer() {
  const handlers = new Map<string, Handler>();
  const sent: { event: string; payload: unknown }[] = [];
  const ws = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    send: (event: string, payload?: unknown) => {
      sent.push({ event, payload });
    },
  };
  return {
    server: { ws } as unknown as ViteDevServer,
    trigger: (event: string, data: unknown, client?: unknown) => handlers.get(event)?.(data, client),
    sent,
  };
}

function createFakeClient() {
  let closeHandler: (() => void) | undefined;
  return {
    client: {
      send: vi.fn(),
      socket: {
        on: (event: string, cb: () => void) => {
          if (event === "close") closeHandler = cb;
        },
      },
    } as unknown as NormalizedHotChannelClient,
    triggerClose: () => closeHandler?.(),
  };
}

describe("registerServerHandlers — bridge events", () => {
  it("pushes a pending record on bridge_call and rebroadcasts", () => {
    const { server, trigger, sent } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);

    const call = { callId: "1", plugin: "haptics", method: "vibrate", args: {}, timestamp: 100 };
    trigger(WEFTER_EVENT.bridgeCall, call);

    expect(state.bridge.toArray()).toEqual([{ ...call, status: "pending" }]);
    expect(sent).toContainEqual({ event: WEFTER_EVENT.bridgeCall, payload: call });
  });

  it("merges bridge_response into the matching call by callId, not appends a separate record", () => {
    const { server, trigger, sent } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);

    const call = { callId: "1", plugin: "haptics", method: "vibrate", args: {}, timestamp: 100 };
    trigger(WEFTER_EVENT.bridgeCall, call);
    const response = { callId: "1", status: "success" as const, result: { ok: true }, durationMs: 12 };
    trigger(WEFTER_EVENT.bridgeResponse, response);

    expect(state.bridge.toArray()).toEqual([{ ...call, ...response }]);
    expect(sent).toContainEqual({ event: WEFTER_EVENT.bridgeResponse, payload: response });
  });

  it("a response with no matching call is simply a no-op merge (never throws)", () => {
    const { server, trigger } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);

    expect(() =>
      trigger(WEFTER_EVENT.bridgeResponse, { callId: "missing", status: "success", durationMs: 1 }),
    ).not.toThrow();
    expect(state.bridge.toArray()).toEqual([]);
  });
});

describe("registerServerHandlers — console events", () => {
  it("pushes console entries and rebroadcasts", () => {
    const { server, trigger, sent } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);

    const entry = { level: "log" as const, args: ["hi"], stack: null, timestamp: 1 };
    trigger(WEFTER_EVENT.console, entry);

    expect(state.console.toArray()).toEqual([entry]);
    expect(sent).toContainEqual({ event: WEFTER_EVENT.console, payload: entry });
  });
});

describe("registerServerHandlers — network events", () => {
  it("merges network_response into the matching request by requestId", () => {
    const { server, trigger } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);

    const request = { requestId: "r1", url: "/api", method: "GET", headers: {}, timestamp: 1 };
    trigger(WEFTER_EVENT.networkRequest, request);
    const response = { requestId: "r1", status: 200, durationMs: 5, bodyPreview: "{}" };
    trigger(WEFTER_EVENT.networkResponse, response);

    expect(state.network.toArray()).toEqual([{ ...request, ...response }]);
  });
});

describe("registerServerHandlers — presence", () => {
  it("adds a client on client_hello and broadcasts the updated client list", () => {
    const { server, trigger, sent } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);
    const { client } = createFakeClient();

    const hello = { clientId: "c1", url: "http://localhost/", timestamp: 1 };
    trigger(WEFTER_EVENT.clientHello, hello, client);

    expect([...state.presence.values()]).toEqual([hello]);
    const listEvents = sent.filter((s) => s.event === WEFTER_EVENT.clientList);
    expect(listEvents.at(-1)?.payload).toEqual([hello]);
  });

  it("removes the client and rebroadcasts once its socket closes", () => {
    const { server, trigger, sent } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);
    const { client, triggerClose } = createFakeClient();

    trigger(WEFTER_EVENT.clientHello, { clientId: "c1", url: "http://localhost/", timestamp: 1 }, client);
    triggerClose();

    expect(state.presence.size).toBe(0);
    expect(sent.filter((s) => s.event === WEFTER_EVENT.clientList).at(-1)?.payload).toEqual([]);
  });
});

describe("registerServerHandlers — replay", () => {
  it("replies to just the requesting client with the full current buffer state", () => {
    const { server, trigger } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);
    const { client } = createFakeClient();

    const call = { callId: "1", plugin: "haptics", method: "vibrate", args: {}, timestamp: 100 };
    trigger(WEFTER_EVENT.bridgeCall, call);
    trigger(WEFTER_EVENT.replayRequest, {}, client);

    expect(client.send).toHaveBeenCalledWith(
      WEFTER_EVENT.replay,
      expect.objectContaining({ bridge: [{ ...call, status: "pending" }] }),
    );
  });
});
