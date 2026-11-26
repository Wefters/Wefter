/**
 * Server side of DevTools: records the events apps send over the Vite socket and relays them to open
 * dashboards. Recent history is kept so a dashboard opened later can catch up.
 */

import type { NormalizedHotChannelClient, ViteDevServer, WebSocketClient } from "vite";
import { RingBuffer } from "./buffer.js";
import {
  WEFTER_EVENT,
  type BridgeCallEvent,
  type BridgeRecord,
  type BridgeResponseEvent,
  type BufferChannel,
  type ClientHelloEvent,
  type ConsoleEvent,
  type NetworkRecord,
  type NetworkRequestEvent,
  type NetworkResponseEvent,
} from "../shared/events.js";

const BRIDGE_CAP = 500;
const CONSOLE_CAP = 1000;
const NETWORK_CAP = 500;

/**
 * What the server remembers: recent bridge calls, console entries and requests, plus the apps currently
 * connected (by socket).
 */
export interface DevtoolsState {
  bridge: RingBuffer<BridgeRecord>;
  console: RingBuffer<ConsoleEvent>;
  network: RingBuffer<NetworkRecord>;
  presence: Map<NormalizedHotChannelClient, ClientHelloEvent>;
}

/** Creates empty state with the default history limits. */
export function createDevtoolsState(): DevtoolsState {
  return {
    bridge: new RingBuffer(BRIDGE_CAP),
    console: new RingBuffer(CONSOLE_CAP),
    network: new RingBuffer(NETWORK_CAP),
    presence: new Map(),
  };
}

/** Sends the list of connected apps to every client. */
function broadcastClientList(server: ViteDevServer, state: DevtoolsState): void {
  server.ws.send(WEFTER_EVENT.clientList, [...state.presence.values()]);
}

/**
 * Listens for DevTools events on the dev server's socket.
 *
 * - Bridge calls and requests are stored as `pending` and completed when their response arrives.
 * - Each event is broadcast so dashboards update live.
 * - An app's hello adds it to the connected list until its socket closes.
 * - Dashboards can ask for a replay of the history, clear a channel, or reload every app.
 */
export function registerServerHandlers(server: ViteDevServer, state: DevtoolsState): void {
  server.ws.on(WEFTER_EVENT.bridgeCall, (data: BridgeCallEvent) => {
    state.bridge.push({ ...data, status: "pending" });
    server.ws.send(WEFTER_EVENT.bridgeCall, data);
  });

  server.ws.on(WEFTER_EVENT.bridgeResponse, (data: BridgeResponseEvent) => {
    state.bridge.updateLast(
      (record) => record.callId === data.callId,
      (record) => ({ ...record, ...data }),
    );
    server.ws.send(WEFTER_EVENT.bridgeResponse, data);
  });

  server.ws.on(WEFTER_EVENT.console, (data: ConsoleEvent) => {
    state.console.push(data);
    server.ws.send(WEFTER_EVENT.console, data);
  });

  server.ws.on(WEFTER_EVENT.networkRequest, (data: NetworkRequestEvent) => {
    state.network.push({ ...data, status: "pending" });
    server.ws.send(WEFTER_EVENT.networkRequest, data);
  });

  server.ws.on(WEFTER_EVENT.networkResponse, (data: NetworkResponseEvent) => {
    state.network.updateLast(
      (record) => record.requestId === data.requestId,
      (record) => ({ ...record, ...data }),
    );
    server.ws.send(WEFTER_EVENT.networkResponse, data);
  });

  server.ws.on(WEFTER_EVENT.clientHello, (data: ClientHelloEvent, client: NormalizedHotChannelClient) => {
    state.presence.set(client, data);
    (client as Partial<WebSocketClient>).socket?.on("close", () => {
      state.presence.delete(client);
      broadcastClientList(server, state);
    });
    broadcastClientList(server, state);
  });

  server.ws.on(WEFTER_EVENT.replayRequest, (_data: unknown, client: NormalizedHotChannelClient) => {
    client.send(WEFTER_EVENT.replay, {
      bridge: state.bridge.toArray(),
      console: state.console.toArray(),
      network: state.network.toArray(),
      presence: [...state.presence.values()],
    });
  });

  server.ws.on(WEFTER_EVENT.clearRequest, (data: { channel: BufferChannel }) => {
    state[data.channel].clear();
    server.ws.send(WEFTER_EVENT.cleared, data);
  });

  server.ws.on(WEFTER_EVENT.reloadRequest, () => {
    reloadConnectedApps(server, state);
  });
}

/**
 * Tells every connected app to reload its page.
 *
 * @returns How many apps were connected when the reload was sent.
 */
export function reloadConnectedApps(server: ViteDevServer, state: DevtoolsState): number {
  server.ws.send(WEFTER_EVENT.reload, {});
  return state.presence.size;
}
