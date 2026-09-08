import { emitDevtoolsEvent, onDevtoolsEvent } from "./emit.js";

interface ClientListEntry {
  clientId?: string;
}

const HELLO_RETRY_MS = 300;
const HELLO_MAX_ATTEMPTS = 20;

let clientId: string | undefined;
let announced = false;
let retryTimer: ReturnType<typeof setInterval> | undefined;

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

// Vite dispatches `vite:ws:connect` the instant the HMR socket opens — which is routinely
// *before* this side-effect import has even executed — and it no longer buffers sends made
// before the socket is open (they throw). A single eager hello plus a connect listener
// therefore loses the race on a cold load and the devtools dashboard shows the app as absent.
// Re-announce on a short interval until the server echoes our id back in a client list, and
// again from scratch on every reconnect.
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

export function __resetPresenceForTest(): void {
  stopRetrying();
  clientId = undefined;
  announced = false;
}

if (typeof window !== "undefined" && import.meta.hot) {
  installPresence();
}
