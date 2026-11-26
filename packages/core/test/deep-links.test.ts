import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLaunchUrl, onDeepLink, parseDeepLink, type DeepLink } from "../src/internal/deep-links.js";

/** A fake shell that holds links like the native inbox does: `takeDeepLinks` returns and clears them. */
function installShell(initial: { url: string; isLaunch: boolean }[] = [], launchUrl: string | null = null) {
  const queue = [...initial];
  const invoke = vi.fn((callId: string, _plugin: string, method: string) => {
    const result =
      method === "takeDeepLinks" ? { links: queue.splice(0) } : method === "getLaunchUrl" ? { url: launchUrl } : {};
    queueMicrotask(() => window.__wefterNative.resolve(callId, JSON.stringify(result)));
  });
  window.AndroidBridge = { invoke };
  return {
    invoke,
    receive(url: string) {
      queue.push({ url, isLaunch: false });
      window.__wefterNative.emit("__system:deepLink", "{}");
    },
  };
}

/** Lets pending bridge calls settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  const state = (globalThis as Record<symbol, { listeners: Set<unknown> } | undefined>)[
    Symbol.for("wefter.deepLinks.state.v1")
  ];
  state?.listeners.clear();
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
});

afterEach(() => {
  delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  vi.unstubAllGlobals();
});

describe("parseDeepLink", () => {
  it("joins host and path for a custom scheme", () => {
    expect(parseDeepLink("myshop://product/42?ref=mail", true)).toEqual({
      url: "myshop://product/42?ref=mail",
      scheme: "myshop",
      path: "/product/42",
      query: { ref: "mail" },
      isLaunch: true,
    });
  });

  it("uses only the path for a web link", () => {
    const link = parseDeepLink("https://shop.example.com/product/42?a=1&a=2", false);
    expect(link).toMatchObject({ scheme: "https", path: "/product/42", query: { a: "2" }, isLaunch: false });
  });

  it("gives / for a bare scheme", () => {
    expect(parseDeepLink("myshop://", false)?.path).toBe("/");
  });

  it("returns null for a value that is not a URL", () => {
    expect(parseDeepLink("not a url", false)).toBeNull();
  });
});

describe("onDeepLink", () => {
  it("delivers a link that arrived before anyone subscribed", async () => {
    installShell([{ url: "myshop://invite/abc", isLaunch: true }]);
    const received: DeepLink[] = [];

    onDeepLink((link) => received.push(link));
    await settle();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ path: "/invite/abc", isLaunch: true });
  });

  it("delivers links that arrive while the app runs", async () => {
    const shell = installShell();
    const received: string[] = [];
    onDeepLink((link) => received.push(link.url));
    await settle();

    shell.receive("myshop://a");
    await settle();
    shell.receive("myshop://b");
    await settle();

    expect(received).toEqual(["myshop://a", "myshop://b"]);
  });

  it("delivers each link once, to every current listener", async () => {
    installShell([{ url: "myshop://x", isLaunch: true }]);
    const first = vi.fn();
    const second = vi.fn();

    onDeepLink(first);
    onDeepLink(second);
    await settle();
    onDeepLink(vi.fn());
    await settle();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("leaves links with the shell while nobody listens", async () => {
    const shell = installShell();
    const sub = onDeepLink(vi.fn());
    await settle();
    sub.remove();

    shell.receive("myshop://later");
    await settle();
    const late = vi.fn();
    onDeepLink(late);
    await settle();

    expect(late).toHaveBeenCalledWith(expect.objectContaining({ url: "myshop://later" }));
  });

  it("reports a listener that throws and keeps notifying the others", async () => {
    installShell([{ url: "myshop://x", isLaunch: false }]);
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const healthy = vi.fn();

    onDeepLink(() => {
      throw new Error("listener failed");
    });
    onDeepLink(healthy);
    await settle();

    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "listener failed" }));
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});

describe("getLaunchUrl", () => {
  it("returns the launch URL from __system.getLaunchUrl", async () => {
    const shell = installShell([], "myshop://start");

    expect(await getLaunchUrl()).toBe("myshop://start");
    expect(shell.invoke).toHaveBeenCalledWith(expect.any(String), "__system", "getLaunchUrl", "{}");
  });

  it("returns null when the app was opened normally", async () => {
    installShell();
    expect(await getLaunchUrl()).toBeNull();
  });
});
