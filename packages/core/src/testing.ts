import "./internal/native-bridge.js";

type MockHandler = (method: string, payload: unknown) => unknown | Promise<unknown>;

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

export function uninstallMockBridge(): void {
  delete window.AndroidBridge;
}
