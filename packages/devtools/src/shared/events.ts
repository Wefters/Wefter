/** How a bridge call ended. */
/**
 * Event names and payloads exchanged between apps, the dev server and the dashboard. Shared by the
 * server and the browser bundle.
 */

export type BridgeStatus = "success" | "error" | "timeout" | "cancelled";

/** Sent by an app when it calls a native method. */
export interface BridgeCallEvent {
  callId: string;
  method: string;
  plugin: string;
  args: unknown;
  timestamp: number;
}

/** Sent by an app when a native call settles. */
export interface BridgeResponseEvent {
  callId: string;
  status: BridgeStatus;
  result?: unknown;
  error?: { code: string; message: string; nativeStack?: string };
  durationMs: number;
}

/** Console method that produced an entry. `uncaught` marks errors nothing caught. */
export type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug" | "uncaught";

/** A console call or uncaught error. `args` are already serialised for display. */
export interface ConsoleEvent {
  level: ConsoleLevel;
  args: unknown[];
  stack: string | null;
  timestamp: number;
}

/** Sent by an app when a `fetch` or `XMLHttpRequest` starts. */
export interface NetworkRequestEvent {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  timestamp: number;
}

/** Sent by an app when a request finishes. Status `0` means it failed before a response arrived. */
export interface NetworkResponseEvent {
  requestId: string;
  status: number;
  durationMs: number;
  bodyPreview: string;
  bodyTruncated?: boolean;
}

/** Sent by an app when it connects, so the server can count it. */
export interface ClientHelloEvent {
  clientId: string;
  url: string;
  timestamp: number;
}

/** The history a dashboard receives when it connects. */
export interface ReplayPayload {
  bridge: BridgeRecord[];
  console: ConsoleEvent[];
  network: NetworkRecord[];
  presence: ClientHelloEvent[];
}

/** A plugin as shown in the Plugins panel. */
export interface PluginInfo {
  id: string;
  methods: string[];
  hooks: string[];
  events: string[];
  androidPermissions: string[];
  iosPermissions: string[];
  hasAndroidSource: boolean;
  hasIosSource: boolean;
}

/** A history the dashboard can clear. */
export type BufferChannel = "bridge" | "console" | "network";

/** A bridge call with its response merged in once it arrives. */
export type BridgeRecord = BridgeCallEvent &
  Partial<Omit<BridgeResponseEvent, "status">> & { status: BridgeStatus | "pending" };
/** A request with its response merged in once it arrives. */
export type NetworkRecord = NetworkRequestEvent &
  Partial<Omit<NetworkResponseEvent, "status">> & { status: number | "pending" };

/** Socket event names. Names starting with `__` are only used between the server and the dashboard. */
export const WEFTER_EVENT = {
  bridgeCall: "wefter:bridge_call",
  bridgeResponse: "wefter:bridge_response",
  console: "wefter:console",
  networkRequest: "wefter:network_request",
  networkResponse: "wefter:network_response",
  clientHello: "wefter:client_hello",
  clientList: "wefter:client_list",
  replayRequest: "wefter:__replay_request",
  replay: "wefter:__replay",
  clearRequest: "wefter:__clear_request",
  cleared: "wefter:__cleared",
  reloadRequest: "wefter:__reload_request",
  reload: "wefter:reload",
} as const;
