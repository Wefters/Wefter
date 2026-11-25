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
import { createStore, type Store } from "./store.js";
import { appendRecord, mergeRecordById } from "./records.js";
import { mountShell, type PanelBadge, type StatusItem } from "./shell.js";
import { createBridgeInspectorPanel } from "./panels/bridge-inspector.js";
import { createClientsPanel } from "./panels/clients.js";
import { createConsolePanel } from "./panels/console.js";
import { createNetworkPanel } from "./panels/network.js";
import { createPluginsPanel } from "./panels/plugins.js";
import cssText from "./styles.css";

export interface MinimalHotContext {
  send(event: string, payload?: unknown): void;
  on(event: string, cb: (data: unknown) => void): void;
}

// Match the dev server's ring buffers so a long session can't grow the dashboard without bound.
const BRIDGE_CAP = 500;
const CONSOLE_CAP = 1000;
const NETWORK_CAP = 500;

function derive<S, T>(source: Store<S>, fn: (state: S) => T): Store<T> {
  const out = createStore(fn(source.get()));
  source.subscribe((state) => out.set(() => fn(state)));
  return out;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const isFailedCall = (r: BridgeRecord) => r.status !== "success" && r.status !== "pending";
const isFailedRequest = (r: NetworkRecord) => r.status !== "pending" && !(r.status >= 200 && r.status < 400);
const isErrorLog = (e: ConsoleEvent) => e.level === "error" || e.level === "uncaught";

export function mountDevtoolsApp(app: HTMLElement, hot: MinimalHotContext): void {
  const bridgeStore = createStore<BridgeRecord[]>([]);
  const consoleStore = createStore<ConsoleEvent[]>([]);
  const networkStore = createStore<NetworkRecord[]>([]);
  const presenceStore = createStore<ClientHelloEvent[]>([]);
  const serverConnected = createStore(true);

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
    bridgeStore.set((records) => appendRecord(records, { ...call, status: "pending" }, BRIDGE_CAP));
  });
  hot.on(WEFTER_EVENT.bridgeResponse, (data: unknown) => {
    const response = data as BridgeResponseEvent;
    bridgeStore.set((records) => mergeRecordById(records, "callId", response));
  });

  hot.on(WEFTER_EVENT.console, (data: unknown) => {
    consoleStore.set((entries) => appendRecord(entries, data as ConsoleEvent, CONSOLE_CAP));
  });

  hot.on(WEFTER_EVENT.networkRequest, (data: unknown) => {
    const request = data as NetworkRequestEvent;
    networkStore.set((records) => appendRecord(records, { ...request, status: "pending" }, NETWORK_CAP));
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

  function reloadDevice(): void {
    hot.send(WEFTER_EVENT.reloadRequest, {});
  }

  hot.on("vite:ws:connect", () => {
    serverConnected.set(() => true);
    requestReplay();
  });
  hot.on("vite:ws:disconnect", () => {
    serverConnected.set(() => false);
    presenceStore.set(() => []);
  });
  requestReplay();

  const bridgeBadge = derive<BridgeRecord[], PanelBadge>(bridgeStore, (records) => {
    const failed = records.filter(isFailedCall).length;
    return failed ? { count: failed, tone: "error" } : { count: records.length };
  });
  const consoleBadge = derive<ConsoleEvent[], PanelBadge>(consoleStore, (entries) => {
    const errors = entries.filter(isErrorLog).length;
    if (errors) return { count: errors, tone: "error" };
    const warnings = entries.filter((e) => e.level === "warn").length;
    return warnings ? { count: warnings, tone: "warn" } : { count: 0 };
  });
  const networkBadge = derive<NetworkRecord[], PanelBadge>(networkStore, (records) => {
    const failed = records.filter(isFailedRequest).length;
    return failed ? { count: failed, tone: "error" } : { count: records.length };
  });
  const clientsBadge = derive<ClientHelloEvent[], PanelBadge>(presenceStore, (clients) => ({ count: clients.length }));

  const stats = createStore<StatusItem[]>([]);
  const refreshStats = () =>
    stats.set(() => {
      const bridge = bridgeStore.get();
      const logs = consoleStore.get();
      const network = networkStore.get();
      const failedCalls = bridge.filter(isFailedCall).length;
      const errors = logs.filter(isErrorLog).length;
      return [
        {
          label: plural(bridge.length, "call") + (failedCalls ? ` · ${failedCalls} failed` : ""),
          tone: failedCalls ? "error" : "",
        },
        {
          label: plural(logs.length, "log") + (errors ? ` · ${plural(errors, "error")}` : ""),
          tone: errors ? "error" : "",
        },
        { label: plural(network.length, "request") },
      ];
    });
  bridgeStore.subscribe(refreshStats);
  consoleStore.subscribe(refreshStats);
  networkStore.subscribe(refreshStats);
  refreshStats();

  mountShell(
    app,
    [
      {
        id: "bridge",
        label: "Bridge",
        badge: bridgeBadge,
        element: createBridgeInspectorPanel(bridgeStore, () => clearChannel("bridge")),
      },
      {
        id: "console",
        label: "Console",
        badge: consoleBadge,
        element: createConsolePanel(consoleStore, () => clearChannel("console")),
      },
      {
        id: "network",
        label: "Network",
        badge: networkBadge,
        element: createNetworkPanel(networkStore, () => clearChannel("network")),
      },
      { id: "plugins", label: "Plugins", element: createPluginsPanel(bridgeStore) },
      {
        id: "clients",
        label: "Clients",
        badge: clientsBadge,
        element: createClientsPanel(presenceStore),
      },
    ],
    presenceStore,
    reloadDevice,
    { serverConnected, stats },
  );
}

document.title = "Wefter DevTools";
const styleTag = document.createElement("style");
styleTag.textContent = cssText;
document.head.appendChild(styleTag);

const appEl = document.getElementById("app");

if (appEl && import.meta.hot) {
  mountDevtoolsApp(appEl, import.meta.hot);
} else if (appEl) {
  appEl.textContent = "Wefter DevTools must be opened through a running Vite dev server.";
}
