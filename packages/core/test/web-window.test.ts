import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockBridge, uninstallMockBridge } from "../src/testing.js";
import { openWebWindow } from "../src/internal/web-window.js";
import { WefterBridgeError } from "../src/internal/errors.js";

const SITE = "https://pay.example.com";
let calls: { method: string; payload: Record<string, unknown> }[];

/** Simulates the native side reporting a web window event. */
function nativeEvent(event: Record<string, unknown>) {
  window.__wefterNative.emit("__system:webWindow", JSON.stringify(event));
}

/** Resolves on the next call to `__system.<method>`. */
function nextCall(method: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const check = () => {
      const found = calls.find((c) => c.method === method);
      if (found) {
        calls.splice(calls.indexOf(found), 1);
        resolve(found.payload);
      } else setTimeout(check, 1);
    };
    check();
  });
}

beforeEach(() => {
  calls = [];
  installMockBridge({
    __system: (method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return method === "takeEvents" ? { events: [] } : {};
    },
  });
});

afterEach(() => {
  uninstallMockBridge();
});

describe("openWebWindow", () => {
  it("opens the window natively with the method names and normalised options", async () => {
    await openWebWindow({
      url: `${SITE}/checkout`,
      allowOrigins: [`${SITE}/`],
      methods: { getUser: () => 1 },
      toolbar: { title: "Checkout" },
    });

    const open = calls.find((c) => c.method === "openWebWindow")!.payload;
    expect(open).toMatchObject({
      url: `${SITE}/checkout`,
      allowOrigins: [SITE],
      outsideLinks: "external",
      presentation: "fullscreen",
      toolbar: { title: "Checkout", navigation: false },
      methods: ["getUser"],
      ephemeral: false,
    });
  });

  it("refuses a URL that isn't from allowOrigins, and works only in a native app", async () => {
    await expect(openWebWindow({ url: "https://evil.example", allowOrigins: [SITE] })).rejects.toMatchObject({
      code: "INVALID_PAYLOAD",
    });
    uninstallMockBridge();
    await expect(openWebWindow({ url: SITE, allowOrigins: [SITE] })).rejects.toBeInstanceOf(WefterBridgeError);
  });

  it("answers the page's calls with the method's result, or its error", async () => {
    const getUser = vi.fn(() => ({ id: 7 }));
    const win = await openWebWindow({ url: SITE, allowOrigins: [SITE], methods: { getUser } });

    nativeEvent({
      id: win.id,
      type: "message",
      origin: SITE,
      message: { wefter: "frame/1", type: "call", id: 1, method: "getUser", args: { a: 1 } },
    });
    const reply = await nextCall("webWindowPost");
    expect(reply.id).toBe(win.id);
    expect(JSON.parse(reply.message as string)).toEqual({ wefter: "frame/1", type: "result", id: 1, value: { id: 7 } });
    expect(getUser).toHaveBeenCalledWith({ a: 1 }, { origin: SITE });

    nativeEvent({
      id: win.id,
      type: "message",
      origin: SITE,
      message: { wefter: "frame/1", type: "call", id: 2, method: "toString" },
    });
    const error = JSON.parse((await nextCall("webWindowPost")).message as string);
    expect(error).toMatchObject({ type: "error", id: 2, error: { code: "UNKNOWN_METHOD" } });
  });

  it("passes events both ways, and reports load, navigation and closing", async () => {
    const win = await openWebWindow({ url: SITE, allowOrigins: [SITE] });
    const seen: unknown[] = [];
    win.on("resize", (data) => seen.push(["resize", data]));
    win.on("load", (data) => seen.push(["load", data]));
    win.on("navigation", (data) => seen.push(["navigation", data]));

    nativeEvent({
      id: win.id,
      type: "message",
      message: { wefter: "frame/1", type: "event", name: "resize", data: 300 },
    });
    nativeEvent({ id: win.id, type: "load", url: SITE, title: "Pay" });
    nativeEvent({ id: win.id, type: "navigation", url: "https://other.example", handled: "external" });
    nativeEvent({ id: "other-window", type: "load", url: SITE });
    expect(seen).toEqual([
      ["resize", 300],
      ["load", { url: SITE, title: "Pay" }],
      ["navigation", { url: "https://other.example", handled: "external" }],
    ]);

    win.emit("theme", "dark");
    expect(JSON.parse((await nextCall("webWindowPost")).message as string)).toEqual({
      wefter: "frame/1",
      type: "event",
      name: "theme",
      data: "dark",
    });

    nativeEvent({ id: win.id, type: "closed", reason: "user" });
    expect(await win.closed).toEqual({ reason: "user" });
  });

  it("closes, injects and loads through the native side", async () => {
    const win = await openWebWindow({ url: SITE, allowOrigins: [SITE] });

    await win.injectScript("1+1");
    expect(await nextCall("webWindowInject")).toEqual({ id: win.id, source: "1+1" });
    await win.loadUrl(`${SITE}/next`);
    expect(await nextCall("webWindowLoad")).toEqual({ id: win.id, url: `${SITE}/next` });
    await expect(win.loadUrl("https://evil.example")).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    const closing = win.close();
    expect(await nextCall("closeWebWindow")).toEqual({ id: win.id });
    nativeEvent({ id: win.id, type: "closed", reason: "app" });
    await closing;
    expect(await win.closed).toEqual({ reason: "app" });
  });
});
