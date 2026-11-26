/**
 * Entry point of the DevTools dashboard. Connects to the dev server's socket, keeps the bridge, console,
 * network and presence data in stores, and mounts the panels inside the shell.
 */

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
import { createConsolePanel } from "./panels/console.js";
import { createNetworkPanel } from "./panels/network.js";
import { createPluginsPanel } from "./panels/plugins.js";
import cssText from "./styles.css";

/** The part of Vite's HMR client the dashboard needs. Tests pass a fake. */
export interface MinimalHotContext {
  send(event: string, payload?: unknown): void;
  on(event: string, cb: (data: unknown) => void): void;
}

/** How many records each panel keeps; older ones are dropped. */
const BRIDGE_CAP = 500;
const CONSOLE_CAP = 1000;
const NETWORK_CAP = 500;

/** A store whose value is computed from another store and follows its changes. */
function derive<S, T>(source: Store<S>, fn: (state: S) => T): Store<T> {
  const out = createStore(fn(source.get()));
  source.subscribe((state) => out.set(() => fn(state)));
  return out;
}

/** `1 call`, `2 calls`. */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Errors, timeouts and cancellations count as failed calls. */
const isFailedCall = (r: BridgeRecord) => r.status !== "success" && r.status !== "pending";
/** Anything outside 2xx/3xx, including network failures, counts as a failed request. */
const isFailedRequest = (r: NetworkRecord) => r.status !== "pending" && !(r.status >= 200 && r.status < 400);
/** Errors and uncaught errors. */
const isErrorLog = (e: ConsoleEvent) => e.level === "error" || e.level === "uncaught";

/**
 * Builds the dashboard inside `app`.
 *
 * It asks the server for the history on start and after every reconnect, applies live events to the
 * stores, and derives the tab badges (failed counts, or totals when nothing failed) and the status bar
 * statistics.
 */
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
    ],
    presenceStore,
    reloadDevice,
    { serverConnected, stats },
  );
}

/**
 * Bootstraps the page: injects the styles and mounts the app, or explains that the dashboard only works
 * through the dev server.
 */
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
