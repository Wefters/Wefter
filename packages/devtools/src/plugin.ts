/**
 * The `@wefterjs/devtools` Vite plugin. While the dev server runs it:
 *
 * - injects a small agent into the app page that loads core's DevTools instrumentation;
 * - collects bridge calls, console output and network traffic sent by connected apps;
 * - serves the dashboard at `/__wefter-devtools`, plus its plugins and reload APIs.
 *
 * It is a no-op in production builds (`apply: "serve"`).
 */

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

/** Options for {@link wefterDevtools}. Reserved; the dashboard route is currently fixed. */
export interface WefterDevtoolsOptions {
  route?: string;
}

/**
 * Creates the DevTools Vite plugin. Add it to the `plugins` of `vite.config.ts`.
 *
 * @example
 * export default defineConfig({ plugins: [vue(), wefterDevtools()] });
 */
export function wefterDevtools(_options: WefterDevtoolsOptions = {}) {
  const state = createDevtoolsState();
  let clientBundleSource: string | undefined;

  return {
    name: "wefter:devtools",
    apply: "serve",

    /**
     * Makes the app and the dashboard share one copy of `@wefterjs/core` and lets Vite serve files from a
     * linked core outside the project root.
     */
    config() {
      return {
        resolve: {
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

    /** Adds the agent script to every app page, but not to the dashboard itself. */
    transformIndexHtml(html, ctx) {
      if (ctx.path.startsWith(DASHBOARD_ROUTE)) return;
      return {
        html,
        tags: [{ tag: "script", attrs: { type: "module", src: AGENT_MODULE_URL }, injectTo: "head" }],
      };
    },

    /**
     * Wires up the event handlers and the HTTP routes. The reload API is registered before the dashboard
     * route, which would otherwise catch it.
     */
    configureServer(server: ViteDevServer) {
      registerServerHandlers(server, state);
      registerPluginsApiMiddleware(server);
      registerReloadApiMiddleware(server, () => reloadConnectedApps(server, state));
      registerDashboardMiddleware(server);
    },
  } satisfies Plugin;
}
