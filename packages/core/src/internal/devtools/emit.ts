/** Sends an event to the Vite dev server over its HMR socket. Does nothing outside development. */
export function emitDevtoolsEvent(event: string, payload: unknown): void {
  import.meta.hot?.send(event, payload);
}

/** Listens for an event the Vite dev server sends over its HMR socket. Does nothing outside development. */
export function onDevtoolsEvent(event: string, cb: (data: unknown) => void): void {
  import.meta.hot?.on(event, cb);
}
