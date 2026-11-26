/**
 * The part of Vite's `import.meta.hot` API that the DevTools instrumentation uses. Declared here so core
 * does not depend on Vite's types.
 */
interface ImportMeta {
  hot?: {
    send(event: string, data?: unknown): void;
    on(event: string, cb: (data: unknown) => void): void;
  };
}
