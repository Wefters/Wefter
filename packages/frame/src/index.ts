/**
 * `@wefterjs/frame`: the side of a website that runs inside a Wefter app, either in an iframe of one of the
 * app's pages or in a web window the app opened. The site calls the methods the app exposes to it and
 * exchanges events with it. Outside an app (a normal browser tab), {@link connectToApp} resolves to `null`
 * and the site works on its own.
 */

/** Version tag on every message; matches `@wefterjs/core`. */
const PROTOCOL = "frame/1";
const DEFAULT_CONNECT_TIMEOUT_MS = 3000;
const DEFAULT_CALL_TIMEOUT_MS = 10000;

/** Why a call to the app failed: the app's error `code` (or `TIMEOUT`, `CLOSED`) and message. */
export class AppCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppCallError";
  }
}

/** A connection to the app. */
export interface AppConnection {
  /** `"frame"` inside an iframe of the app's page, `"window"` inside a web window the app opened. */
  readonly via: "frame" | "window";
  /** The app page's origin (in an iframe), or `"app"` (in a web window). */
  readonly origin: string;
  /** The methods the app lets this site call. */
  readonly methods: string[];
  /**
   * Calls one of the app's methods with `args` (anything structured-cloneable in an iframe; anything JSON
   * can hold in a web window) and resolves to its answer.
   *
   * @throws {AppCallError} With the app's error code, `UNKNOWN_METHOD`, `TIMEOUT` or `CLOSED`.
   */
  call<T = unknown>(method: string, args?: unknown, options?: { timeoutMs?: number }): Promise<T>;
  /** Listens for an event the app sends with `emit(name, data)`. Returns a function that stops it. */
  on(name: string, listener: (data: unknown) => void): () => void;
  /** Sends an event to the app. */
  emit(name: string, data?: unknown): void;
  /** Disconnects. Calls in progress fail with `CLOSED`. */
  close(): void;
}

/** Options for {@link connectToApp}. */
export interface ConnectOptions {
  /**
   * Origins of the app pages this site trusts to embed it, such as
   * `["https://appassets.androidplatform.net", "app://local"]` (the bundled app on Android and iOS) and the
   * dev server's origin during development. Hellos are only sent to these, and only their answers are
   * accepted. Not used in a web window, where the app itself injected the connection.
   */
  appOrigins: string[];
  /** How long to wait for the app to answer, in milliseconds (default 3000). */
  timeoutMs?: number;
}

interface Message {
  wefter?: unknown;
  type?: unknown;
  id?: unknown;
  method?: unknown;
  args?: unknown;
  value?: unknown;
  error?: { code?: unknown; message?: unknown };
  name?: unknown;
  data?: unknown;
  methods?: unknown;
}

/** How messages travel: a message port (iframe) or the web window's injected channel. */
interface Transport {
  send(message: Message): void;
  onMessage(handler: (message: Message) => void): void;
  close(): void;
}

/** The channel a Wefter web window injects into the sites it shows. */
interface WebWindowChannel {
  send(json: string): void;
  listen(handler: (json: string) => void): void;
  methods: string[];
}

declare global {
  interface Window {
    __wefterWindow?: WebWindowChannel;
  }
}

/**
 * Connects to the Wefter app this site runs in.
 *
 * @returns The connection, or `null` when the site is not inside a Wefter app (or the app does not answer
 *   in time, or does not expose anything to this site's origin).
 */
export function connectToApp(options: ConnectOptions): Promise<AppConnection | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const channel = window.__wefterWindow;
  if (channel) return Promise.resolve(connectToWindow(channel));
  if (window.parent === window) return Promise.resolve(null);
  return connectToFrameParent(options);
}

function connectToWindow(channel: WebWindowChannel): AppConnection {
  const transport: Transport = {
    send: (message) => channel.send(JSON.stringify(message)),
    onMessage: (handler) =>
      channel.listen((json) => {
        try {
          handler(JSON.parse(json) as Message);
        } catch {
          // Not a message for us.
        }
      }),
    close: () => {},
  };
  return createConnection("window", "app", channel.methods, transport);
}

function connectToFrameParent(options: ConnectOptions): Promise<AppConnection | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const finish = (connection: AppConnection | null) => {
      clearTimeout(timer);
      window.removeEventListener("message", onWelcome);
      resolve(connection);
    };
    const onWelcome = (event: MessageEvent) => {
      const message = event.data as Message | null;
      if (event.source !== window.parent || !options.appOrigins.includes(event.origin)) return;
      if (!message || message.wefter !== PROTOCOL || message.type !== "welcome" || !event.ports[0]) return;
      const port = event.ports[0];
      const transport: Transport = {
        send: (m) => port.postMessage(m),
        onMessage: (handler) => {
          port.onmessage = (portEvent) => handler(portEvent.data as Message);
        },
        close: () => port.close(),
      };
      const methods = Array.isArray(message.methods) ? message.methods.filter((m) => typeof m === "string") : [];
      finish(createConnection("frame", event.origin, methods, transport));
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onWelcome);
    for (const origin of options.appOrigins) {
      try {
        window.parent.postMessage({ wefter: PROTOCOL, type: "hello" }, origin);
      } catch {
        // An origin that isn't a valid URL; skip it.
      }
    }
  });
}

function createConnection(
  via: AppConnection["via"],
  origin: string,
  methods: string[],
  transport: Transport,
): AppConnection {
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: AppCallError) => void }>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  let nextId = 0;
  let closed = false;

  transport.onMessage((message) => {
    if (!message || message.wefter !== PROTOCOL) return;
    if (message.type === "result" || message.type === "error") {
      const call = pending.get(message.id as number);
      if (!call) return;
      pending.delete(message.id as number);
      if (message.type === "result") call.resolve(message.value);
      else
        call.reject(
          new AppCallError(
            typeof message.error?.code === "string" ? message.error.code : "UNKNOWN",
            typeof message.error?.message === "string" ? message.error.message : "The app's method failed",
          ),
        );
    } else if (message.type === "event" && typeof message.name === "string") {
      listeners.get(message.name)?.forEach((listener) => listener(message.data));
    }
  });

  return {
    via,
    origin,
    methods,
    call<T>(method: string, args?: unknown, callOptions?: { timeoutMs?: number }) {
      if (closed) return Promise.reject(new AppCallError("CLOSED", "The connection to the app is closed"));
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new AppCallError("TIMEOUT", `${method} timed out`));
        }, callOptions?.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value as T);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        try {
          transport.send({ wefter: PROTOCOL, type: "call", id, method, args });
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(new AppCallError("INVALID_PAYLOAD", error instanceof Error ? error.message : String(error)));
        }
      });
    },
    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    },
    emit(name, data) {
      if (!closed) transport.send({ wefter: PROTOCOL, type: "event", name, data });
    },
    close() {
      closed = true;
      transport.close();
      for (const call of pending.values())
        call.reject(new AppCallError("CLOSED", "The connection to the app is closed"));
      pending.clear();
    },
  };
}
