import { emitDevtoolsEvent, onDevtoolsEvent } from "./emit.js";

let clientId: string | undefined;

function sendHello(): void {
  clientId ??= crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  emitDevtoolsEvent("wefter:client_hello", { clientId, url: location.href, timestamp: Date.now() });
}

if (typeof window !== "undefined" && import.meta.hot) {
  sendHello();
  onDevtoolsEvent("vite:ws:connect", sendHello);
}
