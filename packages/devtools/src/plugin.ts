import type { Plugin, ViteDevServer } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDevtoolsState, registerServerHandlers } from "./server/handlers.js";
import {
  loadDevtoolsVirtualModule,
  registerDashboardMiddleware,
  registerPluginsApiMiddleware,
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

    resolveId(source) {
      return resolveDevtoolsVirtualModule(source);
    },

    load(id) {
      clientBundleSource ??= readFileSync(join(here, "client/bundle.js"), "utf-8");
      return loadDevtoolsVirtualModule(id, clientBundleSource);
    },

    configureServer(server: ViteDevServer) {
      registerServerHandlers(server, state);
      registerPluginsApiMiddleware(server);
      registerDashboardMiddleware(server);
    },
  } satisfies Plugin;
}
