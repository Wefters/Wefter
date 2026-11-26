/** Route of the DevTools reload API. */
/**
 * The `r` shortcut: reload the app's web view through the dev server, or restart the app when no web view
 * is connected.
 */

export const DEVTOOLS_RELOAD_ROUTE = "/__wefter-devtools/api/reload";
const RELOAD_TIMEOUT_MS = 1500;

/**
 * Asks the DevTools server to reload every connected web view.
 *
 * @returns How many were connected, or `null` when the request failed (for example without DevTools).
 */
export async function requestWebViewReload(devServerUrl: string): Promise<number | null> {
  try {
    const response = await fetch(`${devServerUrl}${DEVTOOLS_RELOAD_ROUTE}`, {
      method: "POST",
      signal: AbortSignal.timeout(RELOAD_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { clients?: unknown };
    return typeof body.clients === "number" ? body.clients : null;
  } catch {
    return null;
  }
}

/** Whether the web view was reloaded or the app restarted. */
export type ReloadOutcome = { kind: "reloaded"; clients: number } | { kind: "restarted" };

/** Reloads the web view when at least one is connected; otherwise restarts the app with `restartApp`. */
export async function reloadApp(
  devServerUrl: string | null,
  restartApp: () => Promise<void>,
  request: (url: string) => Promise<number | null> = requestWebViewReload,
): Promise<ReloadOutcome> {
  const clients = devServerUrl ? await request(devServerUrl) : null;
  if (clients !== null && clients > 0) return { kind: "reloaded", clients };
  await restartApp();
  return { kind: "restarted" };
}
