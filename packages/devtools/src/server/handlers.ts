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

export interface DevtoolsState {
  bridge: RingBuffer<BridgeRecord>;
  console: RingBuffer<ConsoleEvent>;
  network: RingBuffer<NetworkRecord>;
  presence: Map<NormalizedHotChannelClient, ClientHelloEvent>;
}

export function createDevtoolsState(): DevtoolsState {
  return {
    bridge: new RingBuffer(BRIDGE_CAP),
    console: new RingBuffer(CONSOLE_CAP),
    network: new RingBuffer(NETWORK_CAP),
    presence: new Map(),
  };
}

function broadcastClientList(server: ViteDevServer, state: DevtoolsState): void {
  server.ws.send(WEFTER_EVENT.clientList, [...state.presence.values()]);
}

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

  // Internal control-plane registrations — not part of the documented 5 instrumentation events.
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
}
