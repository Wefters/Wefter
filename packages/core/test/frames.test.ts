import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exposeToFrames, type FrameHost } from "../src/internal/frames.js";

const PARTNER = "https://pay.example.com";

/** An iframe in the page whose window records what the host posts to it. */
function addFrame() {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const posted: { data: unknown; origin: string; ports: MessagePort[] }[] = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(((
    data: unknown,
    origin: string,
    ports?: MessagePort[],
  ) => {
    posted.push({ data, origin, ports: ports ?? [] });
  }) as typeof window.postMessage);
  return { frame, posted };
}

/** Simulates a site in `source` saying hello from `origin`. */
function hello(source: Window | null, origin: string) {
  const event = new Event("message");
  Object.assign(event, { data: { wefter: "frame/1", type: "hello" }, origin, source });
  window.dispatchEvent(event);
}

/** The next message on `port`. */
function next(port: MessagePort): Promise<{ type: string; [key: string]: unknown }> {
  return new Promise((resolve) => {
    port.onmessage = (event) => resolve(event.data);
  });
}

let host: FrameHost | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  host?.close();
  host = null;
});

describe("exposeToFrames", () => {
  it("welcomes an allowed site in one of the page's iframes with its own port and method list", () => {
    host = exposeToFrames({ [PARTNER]: { getUser: () => ({ id: 1 }) } });
    const { frame, posted } = addFrame();

    hello(frame.contentWindow, PARTNER);

    expect(posted).toHaveLength(1);
    expect(posted[0].origin).toBe(PARTNER);
    expect(posted[0].data).toEqual({ wefter: "frame/1", type: "welcome", methods: ["getUser"] });
    expect(posted[0].ports).toHaveLength(1);
    expect(host.connections()).toEqual([{ origin: PARTNER, frame }]);
  });

  it("ignores a site whose origin isn't listed, and a window that isn't one of the page's iframes", () => {
    host = exposeToFrames({ [PARTNER]: { getUser: () => 1 } });
    const { frame, posted } = addFrame();

    hello(frame.contentWindow, "https://evil.example");
    hello(window, PARTNER);

    expect(posted).toHaveLength(0);
    expect(host.connections()).toEqual([]);
  });

  it("matches wildcard origins on subdomains only", () => {
    host = exposeToFrames({ "https://*.partner.example": { ping: () => "pong" } });
    const first = addFrame();
    const second = addFrame();
    const third = addFrame();

    hello(first.frame.contentWindow, "https://shop.partner.example");
    hello(second.frame.contentWindow, "https://a.b.partner.example");
    hello(third.frame.contentWindow, "https://partner.example");

    expect(first.posted).toHaveLength(1);
    expect(second.posted).toHaveLength(1);
    expect(third.posted).toHaveLength(0);
  });

  it("answers calls with the method's result, passing the caller's origin and iframe", async () => {
    const getUser = vi.fn((args: unknown) => ({ id: 7, asked: args }));
    host = exposeToFrames({ [PARTNER]: { getUser } });
    const { frame, posted } = addFrame();
    hello(frame.contentWindow, PARTNER);
    const port = posted[0].ports[0];

    const reply = next(port);
    port.postMessage({ wefter: "frame/1", type: "call", id: 3, method: "getUser", args: { full: true } });

    expect(await reply).toEqual({ wefter: "frame/1", type: "result", id: 3, value: { id: 7, asked: { full: true } } });
    expect(getUser).toHaveBeenCalledWith({ full: true }, { origin: PARTNER, frame });
  });

  it("refuses methods not listed for the site, and reports a failing method's code", async () => {
    host = exposeToFrames({
      [PARTNER]: {
        pay: () => {
          throw Object.assign(new Error("Card declined"), { code: "DECLINED" });
        },
      },
    });
    const { frame, posted } = addFrame();
    hello(frame.contentWindow, PARTNER);
    const port = posted[0].ports[0];

    let reply = next(port);
    port.postMessage({ wefter: "frame/1", type: "call", id: 1, method: "toString" });
    expect(await reply).toMatchObject({ type: "error", id: 1, error: { code: "UNKNOWN_METHOD" } });

    reply = next(port);
    port.postMessage({ wefter: "frame/1", type: "call", id: 2, method: "pay" });
    expect(await reply).toMatchObject({ type: "error", id: 2, error: { code: "DECLINED", message: "Card declined" } });
  });

  it("delivers events both ways", async () => {
    host = exposeToFrames({ [PARTNER]: {} });
    const { frame, posted } = addFrame();
    hello(frame.contentWindow, PARTNER);
    const port = posted[0].ports[0];

    const fromSite = new Promise((resolve) => host!.on("resize", (data, context) => resolve({ data, context })));
    port.postMessage({ wefter: "frame/1", type: "event", name: "resize", data: { height: 300 } });
    expect(await fromSite).toEqual({ data: { height: 300 }, context: { origin: PARTNER, frame } });

    const toSite = next(port);
    host.emit("theme", "dark");
    expect(await toSite).toEqual({ wefter: "frame/1", type: "event", name: "theme", data: "dark" });
  });

  it("replaces the connection when the iframe's page says hello again, and drops removed iframes", () => {
    host = exposeToFrames({ [PARTNER]: {} });
    const { frame } = addFrame();

    hello(frame.contentWindow, PARTNER);
    hello(frame.contentWindow, PARTNER);
    expect(host.connections()).toHaveLength(1);

    hello(frame.contentWindow, "https://evil.example");
    expect(host.connections()).toHaveLength(0);

    hello(frame.contentWindow, PARTNER);
    frame.remove();
    expect(host.connections()).toHaveLength(0);
  });

  it("stops answering after close()", () => {
    host = exposeToFrames({ [PARTNER]: {} });
    const { frame, posted } = addFrame();
    host.close();

    hello(frame.contentWindow, PARTNER);

    expect(posted).toHaveLength(0);
  });
});
