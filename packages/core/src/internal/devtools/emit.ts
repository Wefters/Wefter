export function emitDevtoolsEvent(event: string, payload: unknown): void {
  import.meta.hot?.send(event, payload);
}

export function onDevtoolsEvent(event: string, cb: (data: unknown) => void): void {
  import.meta.hot?.on(event, cb);
}
