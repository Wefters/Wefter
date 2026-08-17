import { describe, expect, it, vi } from "vitest";
import type { ViteDevServer } from "vite";

vi.mock("../src/server/plugins-info.js", () => ({
  collectPluginInfo: vi.fn(() => [{ id: "stub-plugin" }]),
}));

import {
  DASHBOARD_ROUTE,
  loadDevtoolsVirtualModule,
  registerDashboardMiddleware,
  registerPluginsApiMiddleware,
  resolveDevtoolsVirtualModule,
} from "../src/server/middleware.js";
import { collectPluginInfo } from "../src/server/plugins-info.js";

type Handler = (req: unknown, res: unknown, next: (err?: unknown) => void) => void;

function createFakeServer(root = "/project") {
  const routes = new Map<string, Handler>();
  const server = {
    config: { root },
    middlewares: {
      use: (route: string, handler: Handler) => {
        routes.set(route, handler);
      },
    },
    transformIndexHtml: vi.fn((_url: string, html: string) => Promise.resolve(html)),
  };
  return { server: server as unknown as ViteDevServer, routes };
}

function createFakeRes() {
  return {
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(body: string) {
      this.body = body;
    },
  };
}

describe("resolveDevtoolsVirtualModule / loadDevtoolsVirtualModule", () => {
  it("resolves the known virtual specifier to a null-prefixed id", () => {
    expect(resolveDevtoolsVirtualModule("virtual:wefter-devtools-client")).toBe(
      "\0virtual:wefter-devtools-client",
    );
  });

  it("returns undefined for any other specifier", () => {
    expect(resolveDevtoolsVirtualModule("vue")).toBeUndefined();
  });

  it("loads the bundle source only when passed the resolved id", () => {
    expect(loadDevtoolsVirtualModule("\0virtual:wefter-devtools-client", "console.log(1)")).toBe("console.log(1)");
  });

  it("returns undefined for an unrelated id", () => {
    expect(loadDevtoolsVirtualModule("/some/real/file.js", "console.log(1)")).toBeUndefined();
  });
});

describe("registerPluginsApiMiddleware", () => {
  it("registers a handler on the plugins API route", () => {
    const { server, routes } = createFakeServer();
    registerPluginsApiMiddleware(server);
    expect(routes.has("/__wefter-devtools/api/plugins")).toBe(true);
  });

  it("responds with JSON built from collectPluginInfo(server.config.root)", () => {
    const { server, routes } = createFakeServer("/my/project");
    registerPluginsApiMiddleware(server);
    const res = createFakeRes();

    routes.get("/__wefter-devtools/api/plugins")!({}, res, () => {});

    expect(collectPluginInfo).toHaveBeenCalledWith("/my/project");
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(res.body)).toEqual([{ id: "stub-plugin" }]);
  });
});

describe("registerDashboardMiddleware", () => {
  it("registers a handler on the dashboard route", () => {
    const { server, routes } = createFakeServer();
    registerDashboardMiddleware(server);
    expect(routes.has(DASHBOARD_ROUTE)).toBe(true);
  });

  it("runs the shell HTML through transformIndexHtml and serves the result", async () => {
    const { server, routes } = createFakeServer();
    (server.transformIndexHtml as ReturnType<typeof vi.fn>).mockImplementation((_url: string, html: string) =>
      Promise.resolve(html.replace("</body>", "<!-- injected --></body>")),
    );
    registerDashboardMiddleware(server);
    const res = createFakeRes();

    routes.get(DASHBOARD_ROUTE)!({}, res, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(server.transformIndexHtml).toHaveBeenCalledWith(DASHBOARD_ROUTE, expect.stringContaining("<div id=\"app\">"));
    expect(res.headers["Content-Type"]).toBe("text/html");
    expect(res.body).toContain("<!-- injected -->");
  });

  it("references the virtual client module via the /@id/ script src", async () => {
    const { server, routes } = createFakeServer();
    registerDashboardMiddleware(server);
    const res = createFakeRes();

    routes.get(DASHBOARD_ROUTE)!({}, res, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.body).toContain('src="/@id/virtual:wefter-devtools-client"');
  });

  it("forwards a transformIndexHtml rejection to next(err) instead of throwing", async () => {
    const { server, routes } = createFakeServer();
    const err = new Error("transform failed");
    (server.transformIndexHtml as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    registerDashboardMiddleware(server);
    const res = createFakeRes();
    const next = vi.fn();

    routes.get(DASHBOARD_ROUTE)!({}, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(next).toHaveBeenCalledWith(err);
  });
});
