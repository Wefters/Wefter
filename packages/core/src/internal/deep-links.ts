/**
 * Deep links: the URLs the app is opened with, through a custom scheme (`myshop://product/42`) or a verified
 * web link (`https://shop.example.com/product/42`).
 *
 * The native shell keeps every incoming link until the web app takes it, so a link that arrives before the
 * page has loaded, or while it reloads, is not lost. Each link is taken once: reloading the page does not
 * deliver it again.
 *
 * Under the Vite dev server, every delivered link and the number of listeners are reported to DevTools,
 * and the dashboard can send a link to the app as if the shell had received it.
 */

import { invokeNative, onBridgeReady, registerHook } from "./native-bridge.js";
import { tapDeepLink, tapDeepLinkListeners } from "./devtools/deep-link-tap.js";
import { onDevtoolsEvent } from "./devtools/emit.js";
import { claimOnce } from "./devtools/claim-once.js";

/** A URL the app was opened with. */
export interface DeepLink {
  /** The full URL. */
  url: string;
  /** The scheme without the colon, such as `myshop` or `https`. */
  scheme: string;
  /**
   * The in-app path, ready for a router: the URL's path for web links, and the host plus path for custom
   * schemes (`myshop://product/42` gives `/product/42`).
   */
  path: string;
  /** The query parameters. When a key repeats, the last value wins. */
  query: Record<string, string>;
  /** Whether this link started the app, rather than reaching it while it was running. */
  isLaunch: boolean;
}

/** Returned by {@link onDeepLink}; `remove()` stops listening. */
export interface DeepLinkSubscription {
  remove(): void;
}

/** A link as the native shell reports it. */
interface NativeDeepLink {
  url: string;
  isLaunch: boolean;
}

/** Event the shell sends when it has received a link. The links themselves are fetched with `takeDeepLinks`. */
const DEEP_LINK_HOOK = "__system:deepLink";

/** Listener state shared by every copy of this module in the page. */
interface DeepLinkState {
  listeners: Set<(link: DeepLink) => void>;
  hookInstalled: boolean;
  draining: boolean;
  drainAgain: boolean;
}

/** Global key of the shared {@link DeepLinkState}, so two bundled copies of core share one set of listeners. */
const DEEP_LINK_STATE_KEY = Symbol.for("wefter.deepLinks.state.v1");

/** Returns the shared listener state, creating it on first use. */
function getDeepLinkState(): DeepLinkState {
  const holder = globalThis as unknown as Record<symbol, DeepLinkState | undefined>;
  return (holder[DEEP_LINK_STATE_KEY] ??= {
    listeners: new Set(),
    hookInstalled: false,
    draining: false,
    drainAgain: false,
  });
}

/**
 * Splits a URL into the parts of a {@link DeepLink}.
 *
 * @returns The link, or `null` when `url` cannot be parsed.
 */
export function parseDeepLink(url: string, isLaunch: boolean): DeepLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const scheme = parsed.protocol.replace(/:$/, "");
  const isWebLink = scheme === "http" || scheme === "https";
  const rawPath = isWebLink ? parsed.pathname : parsed.host + parsed.pathname;
  const path = "/" + rawPath.replace(/^\/+/, "");

  return { url, scheme, path, query: Object.fromEntries(parsed.searchParams), isLaunch };
}

/**
 * Hands `link` to every listener. A listener that throws is reported as an uncaught error (through
 * `reportError` where the web view has it) without stopping the others.
 */
function notifyListeners(state: DeepLinkState, link: DeepLink): void {
  for (const listener of [...state.listeners]) {
    try {
      listener(link);
    } catch (error) {
      if (typeof globalThis.reportError === "function") globalThis.reportError(error);
      else
        queueMicrotask(() => {
          throw error;
        });
    }
  }
}

/**
 * Takes the links the shell is holding and delivers them to the listeners. Links are left with the shell
 * while nobody listens, and a call made during a running drain makes that drain go round again.
 */
async function drainDeepLinks(state: DeepLinkState): Promise<void> {
  if (state.draining) {
    state.drainAgain = true;
    return;
  }

  state.draining = true;
  try {
    do {
      state.drainAgain = false;
      if (state.listeners.size === 0) return;

      const { links } = await invokeNative<{ links: NativeDeepLink[] }>("__system", "takeDeepLinks", {});
      for (const native of links) {
        const link = parseDeepLink(native.url, native.isLaunch);
        if (link) notifyListeners(state, link);
        if (import.meta.hot) tapDeepLink(native.url, native.isLaunch, link, "native", state.listeners.size);
      }
    } while (state.drainAgain);
  } catch (error) {
    console.error("[wefter] Could not read deep links:", error);
  } finally {
    state.draining = false;
  }
}

/**
 * Calls `callback` for every link the app is opened with: the link that started it (with `isLaunch`) and
 * each one that arrives while it runs. Links that arrived before the first listener are delivered as soon
 * as it subscribes.
 *
 * @example
 * onDeepLink(({ path, query }) => router.push({ path, query }));
 */
export function onDeepLink(callback: (link: DeepLink) => void): DeepLinkSubscription {
  const state = getDeepLinkState();
  state.listeners.add(callback);
  if (import.meta.hot) tapDeepLinkListeners(state.listeners.size);

  if (!state.hookInstalled) {
    state.hookInstalled = true;
    registerHook(DEEP_LINK_HOOK, () => void drainDeepLinks(state));
  }
  void onBridgeReady().then(() => drainDeepLinks(state));

  return {
    remove: () => {
      state.listeners.delete(callback);
      if (import.meta.hot) tapDeepLinkListeners(state.listeners.size);
    },
  };
}

/**
 * The URL that started the app, or `null` when it was opened normally. Unlike {@link onDeepLink}, it can be
 * read any number of times, so it suits checks such as "was this launch from a link?".
 *
 * @throws {WefterBridgeError} `NO_BRIDGE` outside a Wefter app.
 */
export async function getLaunchUrl(): Promise<string | null> {
  const { url } = await invokeNative<{ url: string | null }>("__system", "getLaunchUrl", {});
  return url;
}

/**
 * Delivers `url` to the listeners as a link received while the app runs, for the DevTools "Send to app"
 * button. It skips the native shell, so it tests the app's routing but not the scheme registration.
 */
export function simulateDeepLink(url: string): void {
  const state = getDeepLinkState();
  const link = parseDeepLink(url, false);
  if (link) notifyListeners(state, link);
  if (import.meta.hot) tapDeepLink(url, false, link, "devtools", state.listeners.size);
}

/**
 * Under the dev server: accepts links sent from the dashboard, and reports the listener count when the
 * page loads and after every reconnect, so the dashboard knows whether anything is listening.
 */
if (typeof window !== "undefined" && import.meta.hot && claimOnce("deepLinks")) {
  onDevtoolsEvent("wefter:simulate_deep_link", (data) => {
    const url = (data as { url?: unknown } | null)?.url;
    if (typeof url === "string") simulateDeepLink(url);
  });
  onDevtoolsEvent("vite:ws:connect", () => tapDeepLinkListeners(getDeepLinkState().listeners.size));
  tapDeepLinkListeners(getDeepLinkState().listeners.size);
}
