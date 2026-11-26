import type { Plugin, ViteDevServer } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDevtoolsState, registerServerHandlers, reloadConnectedApps } from "./server/handlers.js";
import {
  AGENT_MODULE_URL,
  DASHBOARD_ROUTE,
  loadDevtoolsVirtualModule,
  registerDashboardMiddleware,
  registerPluginsApiMiddleware,
  registerReloadApiMiddleware,
  resolveDevtoolsVirtualModule,
} from "./server/middleware.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface WefterDevtoolsOptions {
  route?: string;
}

export function wefterDevtools(_options: WefterDevtoolsOptions = {}) {
  const state = createDevtoolsState();
  let clientBundleSource: string | undefined;

  return {
    name: "wefter:devtools",
    apply: "serve",

    config() {
      return {
        resolve: {
          // Plugins usually depend on their own copy of @wefterjs/core. Without deduping, the
          // app bundles one core per plugin; only the app's own copy reports to devtools, so the
          // Bridge Inspector showed nothing but core's internal calls (e.g. __system.isDebug).
          dedupe: ["@wefterjs/core"],
        },
        optimizeDeps: {
          exclude: ["@wefterjs/core"],
        },
        server: {
          fs: {
            strict: false,
          },
        },
      };
    },

    resolveId(source) {
      return resolveDevtoolsVirtualModule(source);
    },

    load(id) {
      clientBundleSource ??= readFileSync(join(here, "client/bundle.js"), "utf-8");
      return loadDevtoolsVirtualModule(id, clientBundleSource);
    },

    transformIndexHtml(html, ctx) {
      // Every served app page, but not the dashboard shell itself.
      if (ctx.path.startsWith(DASHBOARD_ROUTE)) return;
      return {
        html,
        tags: [{ tag: "script", attrs: { type: "module", src: AGENT_MODULE_URL }, injectTo: "head" }],
      };
    },

    configureServer(server: ViteDevServer) {
      registerServerHandlers(server, state);
      registerPluginsApiMiddleware(server);
      // Before the dashboard route: connect matches by prefix and the dashboard owns its parent path.
      registerReloadApiMiddleware(server, () => reloadConnectedApps(server, state));
      registerDashboardMiddleware(server);
    },
  } satisfies Plugin;
}
