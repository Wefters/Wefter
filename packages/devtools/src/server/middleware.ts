import type { ViteDevServer } from "vite";
import { collectPluginInfo } from "./plugins-info.js";

export const DASHBOARD_ROUTE = "/__wefter-devtools";
const PLUGINS_API_ROUTE = "/__wefter-devtools/api/plugins";
const VIRTUAL_CLIENT_ID = "virtual:wefter-devtools-client";
const RESOLVED_VIRTUAL_CLIENT_ID = "\0" + VIRTUAL_CLIENT_ID;

export function resolveDevtoolsVirtualModule(source: string): string | undefined {
  return source === VIRTUAL_CLIENT_ID ? RESOLVED_VIRTUAL_CLIENT_ID : undefined;
}

export function loadDevtoolsVirtualModule(id: string, clientBundleSource: string): string | undefined {
  return id === RESOLVED_VIRTUAL_CLIENT_ID ? clientBundleSource : undefined;
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
