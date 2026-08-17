import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { NormalizedHotChannelClient, ViteDevServer } from "vite";

const bundleDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "client");
const bundlePath = join(bundleDir, "bundle.js");
const BUNDLE_FIXTURE = "/* test fixture bundle */ console.log('wefter-devtools');";

beforeAll(() => {
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(bundlePath, BUNDLE_FIXTURE);
});

afterAll(() => {
  rmSync(bundlePath, { force: true });
});

import { wefterDevtools } from "../src/plugin.js";
import { WEFTER_EVENT } from "../src/shared/events.js";

type Handler = (data: unknown, client: unknown) => void;
type MiddlewareHandler = (req: unknown, res: unknown, next: (err?: unknown) => void) => void;

function createFakeServer() {
  const wsHandlers = new Map<string, Handler>();
  const routes: string[] = [];
  const server = {
    config: { root: "/project" },
    ws: {
      on: (event: string, handler: Handler) => {
        wsHandlers.set(event, handler);
      },
      send: vi.fn(),
    },
    middlewares: {
      use: (route: string, _handler: MiddlewareHandler) => {
        routes.push(route);
      },
    },
    transformIndexHtml: vi.fn().mockResolvedValue("<html></html>"),
  };
  return { server: server as unknown as ViteDevServer, wsHandlers, routes };
}

describe("wefterDevtools", () => {
  it("is a serve-only plugin named wefter:devtools", () => {
    const plugin = wefterDevtools();
    expect(plugin.name).toBe("wefter:devtools");
    expect(plugin.apply).toBe("serve");
  });

  it("resolves the virtual client module id", () => {
    const plugin = wefterDevtools();
    const resolved = (plugin.resolveId as (source: string) => string | undefined)("virtual:wefter-devtools-client");
    expect(resolved).toBe("\0virtual:wefter-devtools-client");
  });

  it("does not resolve unrelated specifiers", () => {
    const plugin = wefterDevtools();
    const resolved = (plugin.resolveId as (source: string) => string | undefined)("vue");
    expect(resolved).toBeUndefined();
  });

  it("loads the client bundle from disk for the resolved virtual id", () => {
    const plugin = wefterDevtools();
    const loaded = (plugin.load as (id: string) => string | undefined)("\0virtual:wefter-devtools-client");
    expect(loaded).toBe(BUNDLE_FIXTURE);
  });

  it("returns undefined from load for an unrelated id", () => {
    const plugin = wefterDevtools();
    const loaded = (plugin.load as (id: string) => string | undefined)("/some/other/file.js");
    expect(loaded).toBeUndefined();
  });

  it("registers bridge/console/network handlers and both HTTP routes on configureServer", () => {
    const plugin = wefterDevtools();
    const { server, wsHandlers, routes } = createFakeServer();

    (plugin.configureServer as (server: ViteDevServer) => void)(server);

    expect(wsHandlers.has(WEFTER_EVENT.bridgeCall)).toBe(true);
    expect(wsHandlers.has(WEFTER_EVENT.console)).toBe(true);
    expect(wsHandlers.has(WEFTER_EVENT.networkRequest)).toBe(true);
    expect(routes).toEqual(["/__wefter-devtools/api/plugins", "/__wefter-devtools"]);
  });

  it("registers the plugins API route before the dashboard route, since middleware matching is prefix-based", () => {
    const plugin = wefterDevtools();
    const { server, routes } = createFakeServer();

    (plugin.configureServer as (server: ViteDevServer) => void)(server);

    const apiIndex = routes.indexOf("/__wefter-devtools/api/plugins");
    const dashboardIndex = routes.indexOf("/__wefter-devtools");
    expect(apiIndex).toBeGreaterThanOrEqual(0);
    expect(apiIndex).toBeLessThan(dashboardIndex);
  });

  it("keeps separate buffer state per plugin instance, not a shared module-level singleton", () => {
    const pluginA = wefterDevtools();
    const pluginB = wefterDevtools();
    const { server: serverA, wsHandlers: handlersA } = createFakeServer();
    const { server: serverB, wsHandlers: handlersB } = createFakeServer();

    (pluginA.configureServer as (server: ViteDevServer) => void)(serverA);
    (pluginB.configureServer as (server: ViteDevServer) => void)(serverB);

    handlersA.get(WEFTER_EVENT.bridgeCall)?.(
      { callId: "1", plugin: "haptics", method: "vibrate", args: {}, timestamp: 1 },
      undefined,
    );

    const replayClient = { send: vi.fn() } as unknown as NormalizedHotChannelClient;
    handlersB.get(WEFTER_EVENT.replayRequest)?.({}, replayClient);

    expect(replayClient.send).toHaveBeenCalledWith(WEFTER_EVENT.replay, expect.objectContaining({ bridge: [] }));
  });
});
