/** HTTP routes and virtual modules served by the DevTools plugin. */

import type { IncomingMessage } from "node:http";
import type { ViteDevServer } from "vite";
import { collectPluginInfo } from "./plugins-info.js";
import { collectDeepLinkInfo } from "./deep-links-info.js";
import { openLinkOnDevice, type CommandRunner } from "./open-link.js";

/** Where the dashboard is served. */
export const DASHBOARD_ROUTE = "/__wefter-devtools";
/** JSON list of the project's plugins, read from `wefter.config.json` and each `plugin.json`. */
const PLUGINS_API_ROUTE = "/__wefter-devtools/api/plugins";
/** JSON list of each environment's deep links, read from `wefter.config.json`. */
const DEEP_LINKS_API_ROUTE = "/__wefter-devtools/api/deep-links";
/** `POST { url, platform }` here opens a link on an Android device or the iOS Simulator. */
export const OPEN_LINK_API_ROUTE = "/__wefter-devtools/api/open-link";
/** Largest request body the open-link route reads. */
const MAX_BODY_BYTES = 8 * 1024;
/** `POST` here reloads every connected app; the CLI's `r` shortcut uses it. */
export const RELOAD_API_ROUTE = "/__wefter-devtools/api/reload";
/** Virtual module holding the dashboard bundle. */
const VIRTUAL_CLIENT_ID = "virtual:wefter-devtools-client";
const RESOLVED_VIRTUAL_CLIENT_ID = "\0" + VIRTUAL_CLIENT_ID;

/** Virtual module injected into app pages. */
const VIRTUAL_AGENT_ID = "virtual:wefter-devtools-agent";
const RESOLVED_VIRTUAL_AGENT_ID = "\0" + VIRTUAL_AGENT_ID;
/** URL the app page loads the agent from. */
export const AGENT_MODULE_URL = `/@id/${VIRTUAL_AGENT_ID}`;

/**
 * The agent: imports `@wefterjs/core` so its DevTools instrumentation installs even when the app has
 * not imported core yet. A missing core is logged at debug level and ignored.
 */
const AGENT_SOURCE = `import(${JSON.stringify("@wefterjs/core")}).catch((err) => {
  console.debug("[wefter:devtools] @wefterjs/core agent unavailable", err);
});
`;

/** Vite `resolveId` hook for the two virtual modules. */
export function resolveDevtoolsVirtualModule(source: string): string | undefined {
  if (source === VIRTUAL_CLIENT_ID) return RESOLVED_VIRTUAL_CLIENT_ID;
  if (source === VIRTUAL_AGENT_ID) return RESOLVED_VIRTUAL_AGENT_ID;
  return undefined;
}

/** Vite `load` hook: returns the dashboard bundle or the agent source. */
export function loadDevtoolsVirtualModule(id: string, clientBundleSource: string): string | undefined {
  if (id === RESOLVED_VIRTUAL_CLIENT_ID) return clientBundleSource;
  if (id === RESOLVED_VIRTUAL_AGENT_ID) return AGENT_SOURCE;
  return undefined;
}

/** Serves the plugins list used by the dashboard's Plugins panel. */
export function registerPluginsApiMiddleware(server: ViteDevServer): void {
  server.middlewares.use(PLUGINS_API_ROUTE, (_req, res) => {
    const plugins = collectPluginInfo(server.config.root);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(plugins));
  });
}

/** Serves the deep link settings used by the dashboard's Deep Links panel. */
export function registerDeepLinksApiMiddleware(server: ViteDevServer): void {
  server.middlewares.use(DEEP_LINKS_API_ROUTE, (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(collectDeepLinkInfo(server.config.root)));
  });
}

/** Reads a small JSON request body, or `undefined` when it is too large or not JSON. */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        req.destroy();
        resolve(undefined);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

/**
 * Serves `POST /__wefter-devtools/api/open-link` with `{ url, platform }`, answering `{ ok, output }`.
 * Other methods get `405`, and a body without a URL or a known platform gets `400`.
 *
 * @param run Runs the adb or simctl command; tests pass a fake.
 */
export function registerOpenLinkApiMiddleware(server: ViteDevServer, run?: CommandRunner): void {
  server.middlewares.use(OPEN_LINK_API_ROUTE, (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end();
      return;
    }
    void readJsonBody(req).then(async (body) => {
      const { url, platform } = (body ?? {}) as { url?: unknown; platform?: unknown };
      res.setHeader("Content-Type", "application/json");
      if (typeof url !== "string" || (platform !== "android" && platform !== "ios")) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, output: 'Expected { "url": string, "platform": "android" | "ios" }.' }));
        return;
      }
      res.end(JSON.stringify(await openLinkOnDevice(platform, url, run)));
    });
  });
}

/**
 * Serves `POST /__wefter-devtools/api/reload`, answering `{ clients }` with the number of apps that
 * were told to reload. Other methods get `405`.
 */
export function registerReloadApiMiddleware(server: ViteDevServer, reloadApps: () => number): void {
  server.middlewares.use(RELOAD_API_ROUTE, (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end();
      return;
    }
    const clients = reloadApps();
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ clients }));
  });
}

/** Serves the dashboard page. It goes through Vite's HTML transform so the HMR client is included. */
export function registerDashboardMiddleware(server: ViteDevServer): void {
  server.middlewares.use(DASHBOARD_ROUTE, (req, res, next) => {
    const shellHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Wefter DevTools</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/@id/${VIRTUAL_CLIENT_ID}"></script>
  </body>
</html>
`;
    server
      .transformIndexHtml(DASHBOARD_ROUTE, shellHtml)
      .then((transformed) => {
        res.setHeader("Content-Type", "text/html");
        res.end(transformed);
      })
      .catch(next);
  });
}
