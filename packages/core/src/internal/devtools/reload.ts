import { onDevtoolsEvent } from "./emit.js";
import { claimOnce } from "./claim-once.js";

/**
 * Reloads the page when the dev server asks for it (the CLI's `r` shortcut and the dashboard's reload
 * button).
 *
 * @param reload What to do on a reload request; defaults to `location.reload()`.
 */
export function installReloadListener(reload: () => void = () => location.reload()): void {
  onDevtoolsEvent("wefter:reload", () => {
    reload();
  });
}

if (typeof window !== "undefined" && import.meta.hot && claimOnce("reload")) {
  installReloadListener();
}
