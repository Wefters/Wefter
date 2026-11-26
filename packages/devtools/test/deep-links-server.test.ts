import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ViteDevServer } from "vite";
import { collectDeepLinkInfo } from "../src/server/deep-links-info.js";
import { isOpenableUrl, openLinkCommand, openLinkOnDevice } from "../src/server/open-link.js";
import {
  OPEN_LINK_API_ROUTE,
  registerDeepLinksApiMiddleware,
  registerOpenLinkApiMiddleware,
} from "../src/server/middleware.js";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "wefter-devtools-deep-links-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectDeepLinkInfo", () => {
  it("resolves each environment's links, with environment fields replacing the top-level ones", () => {
    writeFileSync(
      join(projectRoot, "wefter.config.json"),
      JSON.stringify({
        deepLinks: { schemes: ["myshop"], domains: ["shop.example.com"], paths: ["/product/*"] },
        environments: {
          development: { appId: "com.example.shop.dev", deepLinks: { schemes: ["myshop-dev"], domains: [] } },
          production: { appId: "com.example.shop", deepLinks: { paths: ["*"] } },
        },
      }),
    );

    expect(collectDeepLinkInfo(projectRoot)).toEqual([
      {
        name: "development",
        appId: "com.example.shop.dev",
        schemes: ["myshop-dev"],
        domains: [],
        paths: ["/product/*"],
      },
      { name: "production", appId: "com.example.shop", schemes: ["myshop"], domains: ["shop.example.com"], paths: [] },
    ]);
  });

  it("gives an empty list without a readable config", () => {
    expect(collectDeepLinkInfo(projectRoot)).toEqual([]);
  });
});

describe("open-link", () => {
  it.each(["myshop://cart", "https://shop.example.com/product/42?a=1&b=2"])("accepts %s", (url) => {
    expect(isOpenableUrl(url)).toBe(true);
  });

  it.each(["", "not a url", "myshop://a b", "myshop://a\nb", `myshop://${"a".repeat(3000)}`])("rejects %j", (url) => {
    expect(isOpenableUrl(url)).toBe(false);
  });

  it("quotes the URL for the device shell, so & and ' stay part of it", () => {
    expect(openLinkCommand("android", "myshop://a?x=1&y='2'")).toEqual({
      command: "adb",
      args: ["shell", `am start -W -a android.intent.action.VIEW -d 'myshop://a?x=1&y='\\''2'\\'''`],
    });
  });

  it("opens the link on the booted iOS Simulator", () => {
    expect(openLinkCommand("ios", "myshop://cart")).toEqual({
      command: "xcrun",
      args: ["simctl", "openurl", "booted", "myshop://cart"],
    });
  });

  it("runs the command for a valid URL and refuses an invalid one without running anything", async () => {
    const run = vi.fn(async () => ({ ok: true, output: "Status: ok" }));

    expect(await openLinkOnDevice("ios", "myshop://cart", run)).toEqual({ ok: true, output: "Status: ok" });
    expect(await openLinkOnDevice("android", "not a url", run)).toEqual({ ok: false, output: "Not a valid URL." });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("deep link API routes", () => {
  type Handler = (req: unknown, res: ReturnType<typeof createFakeRes>) => void;

  function createFakeServer() {
    const routes = new Map<string, Handler>();
    const server = {
      config: { root: projectRoot },
      middlewares: { use: (route: string, handler: Handler) => routes.set(route, handler) },
    };
    return { server: server as unknown as ViteDevServer, routes };
  }

  function createFakeRes() {
    let resolveDone: () => void;
    const done = new Promise<void>((resolve) => (resolveDone = resolve));
    return {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: "",
      done,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(body = "") {
        this.body = body;
        resolveDone();
      },
    };
  }

  /** A request whose body is `body`. */
  function createFakeReq(method: string, body = "") {
    const req = Object.assign(new EventEmitter(), { method, setEncoding: vi.fn(), destroy: vi.fn() });
    queueMicrotask(() => {
      if (body) req.emit("data", body);
      req.emit("end");
    });
    return req;
  }

  it("serves the deep link settings as JSON", () => {
    writeFileSync(
      join(projectRoot, "wefter.config.json"),
      JSON.stringify({ environments: { production: { appId: "a.b" } } }),
    );
    const { server, routes } = createFakeServer();
    registerDeepLinksApiMiddleware(server);
    const res = createFakeRes();

    routes.get("/__wefter-devtools/api/deep-links")!({}, res);

    expect(JSON.parse(res.body)).toEqual([{ name: "production", appId: "a.b", schemes: [], domains: [], paths: [] }]);
  });

  it("opens a link for a POST with a URL and platform", async () => {
    const run = vi.fn(async () => ({ ok: true, output: "" }));
    const { server, routes } = createFakeServer();
    registerOpenLinkApiMiddleware(server, run);
    const res = createFakeRes();

    routes.get(OPEN_LINK_API_ROUTE)!(
      createFakeReq("POST", JSON.stringify({ url: "myshop://cart", platform: "ios" })),
      res,
    );
    await res.done;

    expect(run).toHaveBeenCalledWith("xcrun", ["simctl", "openurl", "booted", "myshop://cart"]);
    expect(JSON.parse(res.body)).toEqual({ ok: true, output: "" });
  });

  it("answers 405 to other methods and 400 to a body without a URL or a known platform", async () => {
    const run = vi.fn();
    const { server, routes } = createFakeServer();
    registerOpenLinkApiMiddleware(server, run);

    const get = createFakeRes();
    routes.get(OPEN_LINK_API_ROUTE)!(createFakeReq("GET"), get);
    expect(get.statusCode).toBe(405);

    const bad = createFakeRes();
    routes.get(OPEN_LINK_API_ROUTE)!(
      createFakeReq("POST", JSON.stringify({ url: "myshop://x", platform: "windows" })),
      bad,
    );
    await bad.done;
    expect(bad.statusCode).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
