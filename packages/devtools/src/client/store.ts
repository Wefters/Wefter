export interface Store<T> {
  get(): T;
  set(updater: (state: T) => T): void;
  subscribe(listener: (state: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T) => void>();
  let scheduled = false;

  function notify(): void {
    scheduled = false;
    for (const listener of listeners) listener(state);
  }

  return {
    get: () => state,
    set: (updater) => {
      state = updater(state);
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(notify);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
