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
  type ReplayPayload,
} from "../shared/events.js";
import { createStore } from "./store.js";
import { appendRecord, mergeRecordById } from "./records.js";
import { mountShell } from "./shell.js";
import { createBridgeInspectorPanel } from "./panels/bridge-inspector.js";
import { createConsolePanel } from "./panels/console.js";
import { createNetworkPanel } from "./panels/network.js";
import { createPluginStatePanel } from "./panels/plugin-state.js";
import { createPluginsPanel } from "./panels/plugins.js";
import cssText from "./styles.css";

export interface MinimalHotContext {
  send(event: string, payload?: unknown): void;
  on(event: string, cb: (data: unknown) => void): void;
}

export function mountDevtoolsApp(app: HTMLElement, hot: MinimalHotContext): void {
  const bridgeStore = createStore<BridgeRecord[]>([]);
  const consoleStore = createStore<ConsoleEvent[]>([]);
  const networkStore = createStore<NetworkRecord[]>([]);
  const presenceStore = createStore<ClientHelloEvent[]>([]);

  function requestReplay(): void {
    hot.send(WEFTER_EVENT.replayRequest, {});
  }

  hot.on(WEFTER_EVENT.replay, (data: unknown) => {
    const payload = data as ReplayPayload;
    bridgeStore.set(() => payload.bridge);
    consoleStore.set(() => payload.console);
    networkStore.set(() => payload.network);
    presenceStore.set(() => payload.presence);
  });

  hot.on(WEFTER_EVENT.bridgeCall, (data: unknown) => {
    const call = data as BridgeCallEvent;
    bridgeStore.set((records) => appendRecord(records, { ...call, status: "pending" }));
  });
  hot.on(WEFTER_EVENT.bridgeResponse, (data: unknown) => {
    const response = data as BridgeResponseEvent;
    bridgeStore.set((records) => mergeRecordById(records, "callId", response));
  });

  hot.on(WEFTER_EVENT.console, (data: unknown) => {
    consoleStore.set((entries) => appendRecord(entries, data as ConsoleEvent));
  });

  hot.on(WEFTER_EVENT.networkRequest, (data: unknown) => {
    const request = data as NetworkRequestEvent;
    networkStore.set((records) => appendRecord(records, { ...request, status: "pending" }));
  });
  hot.on(WEFTER_EVENT.networkResponse, (data: unknown) => {
    const response = data as NetworkResponseEvent;
    networkStore.set((records) => mergeRecordById(records, "requestId", response));
  });

  hot.on(WEFTER_EVENT.clientList, (data: unknown) => {
    presenceStore.set(() => data as ClientHelloEvent[]);
  });

  hot.on(WEFTER_EVENT.cleared, (data: unknown) => {
    const { channel } = data as { channel: BufferChannel };
    if (channel === "bridge") bridgeStore.set(() => []);
    else if (channel === "console") consoleStore.set(() => []);
    else if (channel === "network") networkStore.set(() => []);
  });

  function clearChannel(channel: BufferChannel): void {
    hot.send(WEFTER_EVENT.clearRequest, { channel });
  }

  hot.on("vite:ws:connect", requestReplay);
  requestReplay();

  mountShell(
    app,
    [
      {
        id: "bridge",
        label: "Bridge Inspector",
        element: createBridgeInspectorPanel(bridgeStore, () => clearChannel("bridge")),
      },
      { id: "console", label: "Console", element: createConsolePanel(consoleStore, () => clearChannel("console")) },
      { id: "network", label: "Network", element: createNetworkPanel(networkStore, () => clearChannel("network")) },
      { id: "plugin-state", label: "Plugin / Permission State", element: createPluginStatePanel(presenceStore) },
      { id: "plugins", label: "Plugins", element: createPluginsPanel() },
    ],
    presenceStore,
  );
}

document.title = "Wefter Dev Tools";
const styleTag = document.createElement("style");
styleTag.textContent = cssText;
document.head.appendChild(styleTag);

const appEl = document.getElementById("app");

if (appEl && import.meta.hot) {
  mountDevtoolsApp(appEl, import.meta.hot);
} else if (appEl) {
  appEl.textContent = "Wefter Dev Tools must be opened through a running Vite dev server.";
}
