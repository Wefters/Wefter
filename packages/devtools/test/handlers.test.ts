import { describe, expect, it, vi } from "vitest";
import type { NormalizedHotChannelClient, ViteDevServer } from "vite";
import { createDevtoolsState, registerServerHandlers, reloadConnectedApps } from "../src/server/handlers.js";
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

describe("registerServerHandlers — reload", () => {
  it("broadcasts a reload event to every client when a reload is requested", () => {
    const { server, trigger, sent } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);

    trigger(WEFTER_EVENT.reloadRequest, {});

    expect(sent).toContainEqual({ event: WEFTER_EVENT.reload, payload: {} });
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

describe("registerServerHandlers — deep links", () => {
  const link = {
    url: "myshop://cart",
    scheme: "myshop",
    path: "/cart",
    query: {},
    isLaunch: false,
    source: "native" as const,
    listeners: 1,
    timestamp: 1,
  };

  it("keeps deep links and the listener count, rebroadcasts them, and includes them in the replay", () => {
    const { server, trigger, sent } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);
    const { client } = createFakeClient();

    trigger(WEFTER_EVENT.deepLink, link);
    trigger(WEFTER_EVENT.deepLinkListeners, { listeners: 2, timestamp: 1 });
    trigger(WEFTER_EVENT.replayRequest, {}, client);

    expect(sent).toContainEqual({ event: WEFTER_EVENT.deepLink, payload: link });
    expect(sent).toContainEqual({ event: WEFTER_EVENT.deepLinkListeners, payload: { listeners: 2, timestamp: 1 } });
    expect(client.send).toHaveBeenCalledWith(
      WEFTER_EVENT.replay,
      expect.objectContaining({ deepLinks: [link], deepLinkListeners: 2 }),
    );
  });

  it("starts with an unknown listener count", () => {
    expect(createDevtoolsState().deepLinkListeners).toBeNull();
  });

  it("relays a dashboard's link to the apps, ignoring empty ones", () => {
    const { server, trigger, sent } = createFakeServer();
    registerServerHandlers(server, createDevtoolsState());

    trigger(WEFTER_EVENT.simulateDeepLinkRequest, { url: " myshop://cart " });
    trigger(WEFTER_EVENT.simulateDeepLinkRequest, { url: "  " });
    trigger(WEFTER_EVENT.simulateDeepLinkRequest, {});

    expect(sent.filter((e) => e.event === WEFTER_EVENT.simulateDeepLink)).toEqual([
      { event: WEFTER_EVENT.simulateDeepLink, payload: { url: "myshop://cart" } },
    ]);
  });

  it("clears the deep link history on request", () => {
    const { server, trigger, sent } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);

    trigger(WEFTER_EVENT.deepLink, link);
    trigger(WEFTER_EVENT.clearRequest, { channel: "deepLinks" });

    expect(state.deepLinks.toArray()).toEqual([]);
    expect(sent).toContainEqual({ event: WEFTER_EVENT.cleared, payload: { channel: "deepLinks" } });
  });
});

describe("reloadConnectedApps", () => {
  it("broadcasts the reload and returns how many apps are connected to receive it", () => {
    const { server, trigger, sent } = createFakeServer();
    const state = createDevtoolsState();
    registerServerHandlers(server, state);
    trigger(WEFTER_EVENT.clientHello, { clientId: "a", url: "/", timestamp: 1 }, createFakeClient().client);

    expect(reloadConnectedApps(server, state)).toBe(1);
    expect(sent).toContainEqual({ event: WEFTER_EVENT.reload, payload: {} });
  });

  it("returns 0 when no app is connected, so the caller can restart the app natively", () => {
    const { server } = createFakeServer();
    expect(reloadConnectedApps(server, createDevtoolsState())).toBe(0);
  });
});
