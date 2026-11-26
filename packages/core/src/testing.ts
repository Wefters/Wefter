/** Helpers for unit-testing code that talks to native plugins, without a device. */

import "./internal/native-bridge.js";

/** Handles every call to one mocked plugin and returns (or resolves to) its result. */
type MockHandler = (method: string, payload: unknown) => unknown | Promise<unknown>;

/**
 * Installs a fake Android bridge that routes each call to the handler registered for its plugin.
 * Handler results resolve the call and thrown errors reject it with code `MOCK_ERROR`.
 *
 * @example
 * installMockBridge({ Clipboard: (method) => (method === "read" ? { text: "hi" } : null) });
 */
export function installMockBridge(handlers: Record<string, MockHandler>): void {
  window.AndroidBridge = {
    invoke: async (callId, plugin, method, payloadJson) => {
      const handler = handlers[plugin];
      if (!handler) {
        window.__wefterNative.reject(
          callId,
          JSON.stringify({ code: "NO_MOCK_HANDLER", message: `No mock handler for plugin "${plugin}"` }),
        );
        return;
      }
      try {
        const result = await handler(method, JSON.parse(payloadJson));
        window.__wefterNative.resolve(callId, JSON.stringify(result));
      } catch (err) {
        window.__wefterNative.reject(
          callId,
          JSON.stringify({ code: "MOCK_ERROR", message: err instanceof Error ? err.message : String(err) }),
        );
      }
    },
  };
}

/** Removes the fake bridge installed by {@link installMockBridge}. */
export function uninstallMockBridge(): void {
  delete window.AndroidBridge;
}
