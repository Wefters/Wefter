/**
 * Reports deep links to the DevTools dashboard: each link delivered to `onDeepLink` listeners, and how
 * many listeners the app has (with none, links wait in the native shell and seem to be ignored).
 */

import { emitDevtoolsEvent } from "./emit.js";
import type { DeepLink } from "../deep-links.js";

/** Where a link came from: the native shell, or the dashboard's "Send to app" button. */
export type DeepLinkSource = "native" | "devtools";

/**
 * Announces a link as it is delivered. `link` is `null` when the URL could not be parsed, in which case
 * no listener was called.
 */
export function tapDeepLink(
  url: string,
  isLaunch: boolean,
  link: DeepLink | null,
  source: DeepLinkSource,
  listeners: number,
): void {
  emitDevtoolsEvent("wefter:deep_link", {
    url,
    scheme: link?.scheme ?? null,
    path: link?.path ?? null,
    query: link?.query ?? {},
    isLaunch,
    source,
    listeners: link ? listeners : 0,
    timestamp: Date.now(),
  });
}

/** Announces how many `onDeepLink` listeners the app has now. */
export function tapDeepLinkListeners(listeners: number): void {
  emitDevtoolsEvent("wefter:deep_link_listeners", { listeners, timestamp: Date.now() });
}
