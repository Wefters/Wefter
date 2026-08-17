export type BridgeStatus = "success" | "error" | "timeout" | "cancelled";

export interface BridgeCallEvent {
  callId: string;
  method: string;
  plugin: string;
  args: unknown;
  timestamp: number;
}

export interface BridgeResponseEvent {
  callId: string;
  status: BridgeStatus;
  result?: unknown;
  error?: { code: string; message: string; nativeStack?: string };
  durationMs: number;
}

export type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug" | "uncaught";

export interface ConsoleEvent {
  level: ConsoleLevel;
  args: unknown[];
  stack: string | null;
  timestamp: number;
}

export interface NetworkRequestEvent {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  timestamp: number;
}

export interface NetworkResponseEvent {
  requestId: string;
  status: number;
  durationMs: number;
  bodyPreview: string;
  bodyTruncated?: boolean;
}

export interface ClientHelloEvent {
  clientId: string;
  url: string;
  timestamp: number;
}

export interface ReplayPayload {
  bridge: BridgeRecord[];
  console: ConsoleEvent[];
  network: NetworkRecord[];
  presence: ClientHelloEvent[];
}

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

export type BufferChannel = "bridge" | "console" | "network";

export type BridgeRecord = BridgeCallEvent &
  Partial<Omit<BridgeResponseEvent, "status">> & { status: BridgeStatus | "pending" };
export type NetworkRecord = NetworkRequestEvent &
  Partial<Omit<NetworkResponseEvent, "status">> & { status: number | "pending" };

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
} as const;
