import { onDevtoolsEvent } from "./emit.js";

// The devtools dashboard's "Reload device" button asks the dev server to broadcast
// `wefter:reload`; every connected app webview picks it up here and reloads itself.
export function installReloadListener(reload: () => void = () => location.reload()): void {
  onDevtoolsEvent("wefter:reload", () => {
    reload();
  });
}

if (typeof window !== "undefined" && import.meta.hot) {
  installReloadListener();
}
