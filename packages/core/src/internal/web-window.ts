import { invokeNative, isNativeBridgeAvailable, registerHook } from "./native-bridge.js";
import { WefterBridgeError } from "./errors.js";
import { FRAME_PROTOCOL } from "./frames.js";

/** What a method exposed to a web window receives besides its arguments. */
export interface WebWindowCallContext {
  /** Origin of the page in the window that called. */
  origin: string;
}

/** Options for {@link openWebWindow}. */
export interface WebWindowOptions {
  /** The page to open. Its origin must be one of `allowOrigins`. */
  url: string;
  /**
   * Origins the window may show and talk to: `https://host[:port]`, or `http://localhost[:port]` during
   * development. Only pages from these get the connection to the app and `injectScript`.
   */
  allowOrigins: string[];
  /**
   * What happens when a page navigates to another origin: `"external"` (the default) opens it outside
   * the app, in the browser or the app that handles it; `"block"` stays on the current page. Either way
   * a `navigation` event reports it.
   */
  outsideLinks?: "external" | "block";
  /** `"fullscreen"` (the default), or `"sheet"`, a card the user can swipe down on iOS (full screen on Android). */
  presentation?: "fullscreen" | "sheet";
  /** The bar above the page: a title (the page's own by default), a close button, back and forward buttons. */
  toolbar?: { title?: string; navigation?: boolean } | false;
  /** Methods the pages may call with `app.call(name, args)` from `@wefterjs/frame`. */
  methods?: Record<string, (args: unknown, context: WebWindowCallContext) => unknown>;
  /** Script run in each page from `allowOrigins` once it has loaded, like React Native's `injectedJavaScript`. */
  injectScript?: string;
  /**
   * Gives the window its own cookies and storage, thrown away when it closes, instead of sharing the
   * app's. On Android this needs Android System WebView 115 or newer; older versions share the app's.
   */
  ephemeral?: boolean;
  /** Asks sites for their desktop layout. */
  desktopMode?: boolean;
}

/** Why a web window closed. */
export type WebWindowCloseReason = "user" | "app" | "replaced" | "error";

/** Events a web window reports, besides those its pages send with `app.emit(name, data)`. */
export interface WebWindowEvents {
  /** A page finished loading. */
  load: { url: string; title: string };
  /** A page tried to open a URL outside `allowOrigins`; `handled` is how `outsideLinks` dealt with it. */
  navigation: { url: string; handled: "external" | "block" };
  /** The window closed. */
  closed: { reason: WebWindowCloseReason };
}

/** An open web window, returned by {@link openWebWindow}. */
export interface WebWindow {
  readonly id: string;
  /** Sends an event to the window's page (`app.on(name, …)` in `@wefterjs/frame`). */
  emit(name: string, data?: unknown): void;
  /** Listens for `load`, `navigation` and `closed`, or an event the page sends with `app.emit(name, data)`. */
  on<K extends keyof WebWindowEvents>(name: K, listener: (data: WebWindowEvents[K]) => void): () => void;
  on(name: string, listener: (data: unknown) => void): () => void;
  /** Runs `source` in the window's current page, if it is from `allowOrigins`. */
  injectScript(source: string): Promise<void>;
  /** Loads another page from `allowOrigins` in the window. */
  loadUrl(url: string): Promise<void>;
  /** Closes the window. */
  close(): Promise<void>;
  /** Resolves with the reason once the window has closed. */
  readonly closed: Promise<{ reason: WebWindowCloseReason }>;
}

interface WindowState {
  options: WebWindowOptions;
  listeners: Map<string, Set<(data: unknown) => void>>;
  resolveClosed: (value: { reason: WebWindowCloseReason }) => void;
}

interface NativeWindowEvent {
  id?: string;
  type?: string;
  origin?: string;
  message?: {
    wefter?: unknown;
    type?: unknown;
    id?: unknown;
    method?: unknown;
    args?: unknown;
    name?: unknown;
    data?: unknown;
  };
  url?: string;
  title?: string;
  handled?: "external" | "block";
  reason?: WebWindowCloseReason;
}

const windows = new Map<string, WindowState>();
let listening = false;
let nextWindow = 0;

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    throw new WefterBridgeError("INVALID_PAYLOAD", `Not a valid URL: ${url}`);
  }
}

function errorBody(error: unknown): { code: string; message: string } {
  const code =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "METHOD_FAILED";
  return { code, message: error instanceof Error ? error.message : String(error) };
}

/** Sends a frame-protocol message to the page in window `id`. */
function post(id: string, message: Record<string, unknown>): Promise<unknown> {
  return invokeNative("__system", "webWindowPost", {
    id,
    message: JSON.stringify({ wefter: FRAME_PROTOCOL, ...message }),
  });
}

async function handleCall(id: string, state: WindowState, event: NativeWindowEvent): Promise<void> {
  const message = event.message ?? {};
  const method = typeof message.method === "string" ? message.method : "";
  const methods = state.options.methods ?? {};
  try {
    if (!Object.prototype.hasOwnProperty.call(methods, method)) {
      throw Object.assign(new Error(`The app has no method ${method} for this window`), { code: "UNKNOWN_METHOD" });
    }
    const value = await methods[method](message.args, { origin: event.origin ?? "" });
    await post(id, { type: "result", id: message.id, value: value === undefined ? null : value });
  } catch (error) {
    await post(id, { type: "error", id: message.id, error: errorBody(error) }).catch(() => {});
  }
}

function onNativeEvent(data: unknown): void {
  const event = data as NativeWindowEvent;
  const id = event?.id;
  const state = id ? windows.get(id) : undefined;
  if (!id || !state) return;
  const emitLocal = (name: string, payload: unknown) =>
    state.listeners.get(name)?.forEach((listener) => listener(payload));

  switch (event.type) {
    case "message": {
      const message = event.message;
      if (!message || message.wefter !== FRAME_PROTOCOL) return;
      if (message.type === "call") void handleCall(id, state, event);
      else if (message.type === "event" && typeof message.name === "string") emitLocal(message.name, message.data);
      return;
    }
    case "load":
      emitLocal("load", { url: event.url ?? "", title: event.title ?? "" });
      return;
    case "navigation":
      emitLocal("navigation", { url: event.url ?? "", handled: event.handled ?? "external" });
      return;
    case "closed": {
      const reason = event.reason ?? "user";
      windows.delete(id);
      emitLocal("closed", { reason });
      state.resolveClosed({ reason });
      return;
    }
  }
}

/**
 * Opens a website over the app in a native web view, and lets it call the app's methods and exchange
 * events with it through `@wefterjs/frame` (`connectToApp()`), like React Native's `<WebView>` with
 * `onMessage` and `injectJavaScript`.
 *
 * Use it for sites you own or work with, including ones that refuse to be shown in iframes. The site never
 * gets the native bridge itself: the app's methods decide what it may do. For sites you don't control, and
 * for sign-in, use the system browser (`@wefterjs/browser`) instead. One web window is open at a time;
 * opening another closes the first with the reason `replaced`.
 *
 * @throws {WefterBridgeError} `NO_BRIDGE` outside a native app, `INVALID_PAYLOAD` when `url` is not from
 *   `allowOrigins`.
 *
 * @example
 * const win = await openWebWindow({
 *   url: "https://pay.example.com/checkout?order=42",
 *   allowOrigins: ["https://pay.example.com"],
 *   methods: { paymentDone: async ({ orderId }) => { await win.close(); showOrder(orderId); } },
 * });
 */
export async function openWebWindow(options: WebWindowOptions): Promise<WebWindow> {
  if (!isNativeBridgeAvailable()) {
    throw new WefterBridgeError("NO_BRIDGE", "openWebWindow() only works inside a Wefter app");
  }
  const allowOrigins = options.allowOrigins.map((origin) => originOf(origin));
  if (!allowOrigins.includes(originOf(options.url))) {
    throw new WefterBridgeError("INVALID_PAYLOAD", `${options.url} is not from one of allowOrigins`);
  }
  if (!listening) {
    listening = true;
    registerHook("__system:webWindow", onNativeEvent);
  }

  const id = `window-${Date.now().toString(36)}-${nextWindow++}`;
  let resolveClosed: WindowState["resolveClosed"] = () => {};
  const closed = new Promise<{ reason: WebWindowCloseReason }>((resolve) => {
    resolveClosed = resolve;
  });
  const state: WindowState = { options, listeners: new Map(), resolveClosed };
  windows.set(id, state);

  try {
    await invokeNative("__system", "openWebWindow", {
      id,
      url: options.url,
      allowOrigins,
      outsideLinks: options.outsideLinks ?? "external",
      presentation: options.presentation ?? "fullscreen",
      toolbar:
        options.toolbar === false
          ? false
          : { title: options.toolbar?.title ?? "", navigation: !!options.toolbar?.navigation },
      methods: Object.keys(options.methods ?? {}),
      injectScript: options.injectScript ?? "",
      ephemeral: !!options.ephemeral,
      desktopMode: !!options.desktopMode,
    });
  } catch (error) {
    windows.delete(id);
    throw error;
  }

  return {
    id,
    closed,
    emit(name, data) {
      if (windows.has(id))
        void post(id, { type: "event", name, data: data === undefined ? null : data }).catch(() => {});
    },
    on(name: string, listener: (data: never) => void) {
      const set = state.listeners.get(name) ?? new Set();
      set.add(listener as (data: unknown) => void);
      state.listeners.set(name, set);
      return () => set.delete(listener as (data: unknown) => void);
    },
    async injectScript(source) {
      await invokeNative("__system", "webWindowInject", { id, source });
    },
    async loadUrl(url) {
      if (!allowOrigins.includes(originOf(url))) {
        throw new WefterBridgeError("INVALID_PAYLOAD", `${url} is not from one of allowOrigins`);
      }
      await invokeNative("__system", "webWindowLoad", { id, url });
    },
    async close() {
      if (!windows.has(id)) return;
      await invokeNative("__system", "closeWebWindow", { id });
      await closed;
    },
  };
}
