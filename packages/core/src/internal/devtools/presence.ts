/**
 * Tells the DevTools server which app instances are connected, so the CLI knows whether a reload can
 * reach a web view.
 */

import { emitDevtoolsEvent, onDevtoolsEvent } from "./emit.js";
import { claimOnce } from "./claim-once.js";

interface ClientListEntry {
  clientId?: string;
}

const HELLO_RETRY_MS = 300;
const HELLO_MAX_ATTEMPTS = 20;

let clientId: string | undefined;
let announced = false;
let retryTimer: ReturnType<typeof setInterval> | undefined;

/** Sends this page's client id and URL to the dev server. */
function sendHello(): void {
  clientId ??= crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  emitDevtoolsEvent("wefter:client_hello", { clientId, url: location.href, timestamp: Date.now() });
}

function stopRetrying(): void {
  if (retryTimer !== undefined) {
    clearInterval(retryTimer);
    retryTimer = undefined;
  }
}

/**
 * Says hello and keeps repeating it every {@link HELLO_RETRY_MS} until the server lists this client
 * or {@link HELLO_MAX_ATTEMPTS} is reached, since the socket may not be ready on the first try.
 */
function announce(): void {
  announced = false;
  stopRetrying();
  let attempts = 0;
  sendHello();
  retryTimer = setInterval(() => {
    if (announced || ++attempts >= HELLO_MAX_ATTEMPTS) {
      stopRetrying();
      return;
    }
    sendHello();
  }, HELLO_RETRY_MS);
}

/** Starts announcing this client, and announces again after every reconnect to the dev server. */
export function installPresence(): void {
  onDevtoolsEvent("wefter:client_list", (list) => {
    if (Array.isArray(list) && list.some((entry) => (entry as ClientListEntry)?.clientId === clientId)) {
      announced = true;
      stopRetrying();
    }
  });
  onDevtoolsEvent("vite:ws:connect", announce);
  announce();
}

/** Forgets the client id and stops retrying. Test-only. */
export function __resetPresenceForTest(): void {
  stopRetrying();
  clientId = undefined;
  announced = false;
}

if (typeof window !== "undefined" && import.meta.hot && claimOnce("presence")) {
  installPresence();
}
