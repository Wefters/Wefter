import { tapBridgeCall, tapBridgeSettle } from "./devtools/bridge-tap.js";

/**
 * Version tag on every message between the app's page and an embedded site (`@wefterjs/frame`). A site
 * using another version is ignored.
 */
export const FRAME_PROTOCOL = "frame/1";

/** What a method exposed to frames receives besides its arguments. */
export interface FrameCallContext {
  /** Origin of the site that called, such as `https://pay.example.com`. */
  origin: string;
  /** The iframe the site is in. */
  frame: HTMLIFrameElement;
}

/** A method a site may call: it gets the site's arguments and returns (or resolves to) the answer. */
export type FrameMethod = (args: unknown, context: FrameCallContext) => unknown;

/**
 * The methods each site may call, by origin. An origin is `https://host[:port]`, or `https://*.example.com`
 * for any subdomain of `example.com`.
 */
export type FrameMethods = Record<string, Record<string, FrameMethod>>;

/** The app's side of the frames it talks to, returned by {@link exposeToFrames}. */
export interface FrameHost {
  /** Sends an event to every connected site, or only to sites whose origin or iframe matches `to`. */
  emit(name: string, data?: unknown, to?: { origin?: string; frame?: HTMLIFrameElement }): void;
  /** Listens for an event sites send with `app.emit(name, data)`. */
  on(name: string, listener: (data: unknown, context: FrameCallContext) => void): () => void;
  /** The sites connected now. */
  connections(): FrameCallContext[];
  /** Stops answering and disconnects every site. */
  close(): void;
}

interface Connection extends FrameCallContext {
  port: MessagePort;
  methods: Record<string, FrameMethod>;
}

interface Message {
  wefter?: unknown;
  type?: unknown;
  id?: unknown;
  method?: unknown;
  args?: unknown;
  name?: unknown;
  data?: unknown;
}

/** Turns an origin pattern into a test. `*.` matches one or more subdomain labels. */
function originMatcher(pattern: string): (origin: string) => boolean {
  if (!pattern.includes("*")) return (origin) => origin === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace("*\\.", "(?:[a-z0-9-]+\\.)+")}$`, "i");
  return (origin) => regex.test(origin);
}

/** The error a failed method sends back: its `code` when it has one, and its message. */
function errorBody(error: unknown): { code: string; message: string } {
  const code =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "METHOD_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  return { code, message };
}

/**
 * Lets sites embedded in the app's iframes call the app's methods and exchange events with it, through
 * `@wefterjs/frame` on the site's side.
 *
 * A site is answered only when its origin is listed in `methods` and it is in one of this page's iframes;
 * it may call only the methods listed for its origin. Each site gets its own message channel, so sites
 * never see each other's messages. When an iframe loads another page, that page must connect again and is
 * checked again. Nothing here involves native code: the app decides what each method does, including
 * whether it calls a plugin.
 *
 * The sites must also be allowed to load, with `frames.allow` in `wefter.config.json`.
 *
 * @example
 * const frames = exposeToFrames({
 *   "https://pay.example.com": {
 *     getUser: () => ({ id: user.id }),
 *     paymentDone: ({ orderId }) => router.push(`/orders/${orderId}`),
 *   },
 * });
 * frames.emit("cart:updated", cart);
 */
export function exposeToFrames(methods: FrameMethods): FrameHost {
  const origins = Object.entries(methods).map(([pattern, list]) => ({ matches: originMatcher(pattern), list }));
  const connections = new Map<HTMLIFrameElement, Connection>();
  const listeners = new Map<string, Set<(data: unknown, context: FrameCallContext) => void>>();
  let closed = false;
  let nextCallId = 0;

  const disconnect = (frame: HTMLIFrameElement) => {
    connections.get(frame)?.port.close();
    connections.delete(frame);
  };

  const prune = () => {
    for (const frame of [...connections.keys()]) if (!frame.isConnected) disconnect(frame);
  };

  const observer =
    typeof MutationObserver !== "undefined" && typeof document !== "undefined" ? new MutationObserver(prune) : null;
  observer?.observe(document.documentElement, { childList: true, subtree: true });

  const handleCall = async (connection: Connection, message: Message) => {
    const id = message.id;
    const method = typeof message.method === "string" ? message.method : "";
    const implementation = Object.prototype.hasOwnProperty.call(connection.methods, method)
      ? connection.methods[method]
      : undefined;
    const callId = `frame-${nextCallId++}`;
    const startedAt = Date.now();
    if (import.meta.hot) tapBridgeCall(callId, `frame ${connection.origin}`, method, message.args);
    try {
      if (!implementation) {
        throw Object.assign(new Error(`${connection.origin} may not call ${method}`), { code: "UNKNOWN_METHOD" });
      }
      const value = await implementation(message.args, { origin: connection.origin, frame: connection.frame });
      if (import.meta.hot) tapBridgeSettle(callId, "success", startedAt, { result: value });
      connection.port.postMessage({ wefter: FRAME_PROTOCOL, type: "result", id, value });
    } catch (error) {
      if (import.meta.hot) tapBridgeSettle(callId, "error", startedAt, { error });
      connection.port.postMessage({ wefter: FRAME_PROTOCOL, type: "error", id, error: errorBody(error) });
    }
  };

  const onHello = (event: MessageEvent) => {
    const message = event.data as Message | null;
    if (closed || !message || message.wefter !== FRAME_PROTOCOL || message.type !== "hello") return;
    const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === event.source);
    if (!frame) return;
    disconnect(frame);
    const allowed = origins.find((entry) => entry.matches(event.origin));
    if (!allowed) return;

    const channel = new MessageChannel();
    const connection: Connection = { origin: event.origin, frame, port: channel.port1, methods: allowed.list };
    connections.set(frame, connection);
    channel.port1.onmessage = (portEvent) => {
      const portMessage = portEvent.data as Message | null;
      if (!portMessage || portMessage.wefter !== FRAME_PROTOCOL || !connections.has(frame)) return;
      if (portMessage.type === "call") void handleCall(connection, portMessage);
      else if (portMessage.type === "event" && typeof portMessage.name === "string") {
        listeners
          .get(portMessage.name)
          ?.forEach((listener) => listener(portMessage.data, { origin: event.origin, frame }));
      }
    };
    (event.source as Window).postMessage(
      { wefter: FRAME_PROTOCOL, type: "welcome", methods: Object.keys(allowed.list) },
      event.origin,
      [channel.port2],
    );
  };

  window.addEventListener("message", onHello);

  return {
    emit(name, data, to) {
      prune();
      for (const connection of connections.values()) {
        if (to?.origin && connection.origin !== to.origin) continue;
        if (to?.frame && connection.frame !== to.frame) continue;
        connection.port.postMessage({ wefter: FRAME_PROTOCOL, type: "event", name, data });
      }
    },
    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    },
    connections() {
      prune();
      return [...connections.values()].map(({ origin, frame }) => ({ origin, frame }));
    },
    close() {
      closed = true;
      window.removeEventListener("message", onHello);
      observer?.disconnect();
      for (const frame of [...connections.keys()]) disconnect(frame);
    },
  };
}
