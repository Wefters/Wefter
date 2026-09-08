import type { ViteDevServer } from "vite";
import { collectPluginInfo } from "./plugins-info.js";

export const DASHBOARD_ROUTE = "/__wefter-devtools";
const PLUGINS_API_ROUTE = "/__wefter-devtools/api/plugins";
const VIRTUAL_CLIENT_ID = "virtual:wefter-devtools-client";
const RESOLVED_VIRTUAL_CLIENT_ID = "\0" + VIRTUAL_CLIENT_ID;

const VIRTUAL_AGENT_ID = "virtual:wefter-devtools-agent";
const RESOLVED_VIRTUAL_AGENT_ID = "\0" + VIRTUAL_AGENT_ID;
export const AGENT_MODULE_URL = `/@id/${VIRTUAL_AGENT_ID}`;

// Injected into every app page (see the plugin's transformIndexHtml). Loading @wefterjs/core
// runs its devtools instrumentation — presence, console/network taps, reload listener — so the
// dashboard sees the app even when the app's own code never imports @wefterjs/core directly, or
// only reaches it transitively through a plugin that pins an older, un-instrumented copy.
const AGENT_SOURCE = `import(${JSON.stringify("@wefterjs/core")}).catch((err) => {
  console.debug("[wefter:devtools] @wefterjs/core agent unavailable", err);
});
`;

export function resolveDevtoolsVirtualModule(source: string): string | undefined {
  if (source === VIRTUAL_CLIENT_ID) return RESOLVED_VIRTUAL_CLIENT_ID;
  if (source === VIRTUAL_AGENT_ID) return RESOLVED_VIRTUAL_AGENT_ID;
  return undefined;
}

export function loadDevtoolsVirtualModule(id: string, clientBundleSource: string): string | undefined {
  if (id === RESOLVED_VIRTUAL_CLIENT_ID) return clientBundleSource;
  if (id === RESOLVED_VIRTUAL_AGENT_ID) return AGENT_SOURCE;
  return undefined;
}

export function registerPluginsApiMiddleware(server: ViteDevServer): void {
  server.middlewares.use(PLUGINS_API_ROUTE, (_req, res) => {
    const plugins = collectPluginInfo(server.config.root);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(plugins));
  });
}

export function registerDashboardMiddleware(server: ViteDevServer): void {
  server.middlewares.use(DASHBOARD_ROUTE, (req, res, next) => {
    const shellHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Wefter Dev Tools</title>
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
