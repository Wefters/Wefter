/** Served by @wefterjs/devtools inside the Vite dev server. */
export const DEVTOOLS_RELOAD_ROUTE = "/__wefter-devtools/api/reload";
const RELOAD_TIMEOUT_MS = 1500;

/**
 * Asks the dev server to reload every connected app web view. Resolves to the number of apps
 * that received the reload, or null when it couldn't be asked (devtools not installed, older
 * devtools without the endpoint, dev server down).
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

export type ReloadOutcome = { kind: "reloaded"; clients: number } | { kind: "restarted" };

/**
 * `r`: reload the app's web view through the dev server when an app is connected to it (instant,
 * keeps native state); otherwise restart the app natively so the shortcut always does something.
 */
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
