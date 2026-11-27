import { afterEach, describe, expect, it, vi } from "vitest";
import { AppCallError, connectToApp } from "../src/index.js";

const APP = "https://appassets.androidplatform.net";

/** Makes `window.parent` a fake page that records hellos. */
function fakeParent() {
  const hellos: { data: unknown; origin: string }[] = [];
  const parent = {
    postMessage: (data: unknown, origin: string) => hellos.push({ data, origin }),
  };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  return { parent, hellos };
}

/** Simulates the app page's welcome, handing over `port`. */
function welcome(source: unknown, origin: string, port: MessagePort, methods: string[] = ["getUser"]) {
  const event = new Event("message");
  Object.assign(event, { data: { wefter: "frame/1", type: "welcome", methods }, origin, source, ports: [port] });
  window.dispatchEvent(event);
}

afterEach(() => {
  Object.defineProperty(window, "parent", { value: window, configurable: true });
  delete window.__wefterWindow;
});

describe("connectToApp in an iframe", () => {
  it("resolves to null when the page is not in a frame", async () => {
    expect(await connectToApp({ appOrigins: [APP] })).toBeNull();
  });

  it("says hello only to the trusted app origins and connects on their welcome", async () => {
    const { parent, hellos } = fakeParent();
    const channel = new MessageChannel();

    const connecting = connectToApp({ appOrigins: [APP, "app://local"] });
    expect(hellos.map((h) => h.origin)).toEqual([APP, "app://local"]);
    welcome(parent, APP, channel.port2);
    const app = await connecting;

    expect(app).toMatchObject({ via: "frame", origin: APP, methods: ["getUser"] });
  });

  it("ignores welcomes from other origins or other windows, then gives up", async () => {
    const { parent } = fakeParent();
    const connecting = connectToApp({ appOrigins: [APP], timeoutMs: 50 });

    welcome(parent, "https://evil.example", new MessageChannel().port2);
    welcome(window, APP, new MessageChannel().port2);

    expect(await connecting).toBeNull();
  });

  it("calls the app's methods and exchanges events over the port", async () => {
    const { parent } = fakeParent();
    const channel = new MessageChannel();
    const connecting = connectToApp({ appOrigins: [APP] });
    welcome(parent, APP, channel.port2);
    const app = (await connecting)!;

    channel.port1.onmessage = (event) => {
      const message = event.data;
      if (message.type === "call" && message.method === "getUser") {
        channel.port1.postMessage({ wefter: "frame/1", type: "result", id: message.id, value: { id: 7 } });
      } else if (message.type === "call") {
        channel.port1.postMessage({
          wefter: "frame/1",
          type: "error",
          id: message.id,
          error: { code: "UNKNOWN_METHOD", message: "no" },
        });
      } else if (message.type === "event") {
        channel.port1.postMessage({ wefter: "frame/1", type: "event", name: "echo", data: message.data });
      }
    };

    expect(await app.call("getUser")).toEqual({ id: 7 });
    await expect(app.call("pay")).rejects.toMatchObject({ code: "UNKNOWN_METHOD" });

    const echoed = new Promise((resolve) => app.on("echo", resolve));
    app.emit("ping", { n: 1 });
    expect(await echoed).toEqual({ n: 1 });
  });

  it("times out calls the app never answers, and fails calls after close()", async () => {
    const { parent } = fakeParent();
    const channel = new MessageChannel();
    const connecting = connectToApp({ appOrigins: [APP] });
    welcome(parent, APP, channel.port2);
    const app = (await connecting)!;

    await expect(app.call("slow", undefined, { timeoutMs: 20 })).rejects.toMatchObject({ code: "TIMEOUT" });
    const pending = app.call("slow");
    app.close();
    await expect(pending).rejects.toBeInstanceOf(AppCallError);
    await expect(app.call("x")).rejects.toMatchObject({ code: "CLOSED" });
  });
});

describe("connectToApp in a web window", () => {
  it("uses the channel the app injected, as JSON", async () => {
    const sent: string[] = [];
    let deliver: (json: string) => void = () => {};
    window.__wefterWindow = {
      methods: ["paymentDone"],
      send: (json) => sent.push(json),
      listen: (handler) => {
        deliver = handler;
      },
    };

    const app = (await connectToApp({ appOrigins: [] }))!;
    expect(app).toMatchObject({ via: "window", origin: "app", methods: ["paymentDone"] });

    const result = app.call("paymentDone", { orderId: 42 });
    const call = JSON.parse(sent[0]);
    expect(call).toMatchObject({ wefter: "frame/1", type: "call", method: "paymentDone", args: { orderId: 42 } });
    deliver(JSON.stringify({ wefter: "frame/1", type: "result", id: call.id, value: true }));
    expect(await result).toBe(true);

    const onTheme = vi.fn();
    app.on("theme", onTheme);
    deliver(JSON.stringify({ wefter: "frame/1", type: "event", name: "theme", data: "dark" }));
    deliver("not json");
    expect(onTheme).toHaveBeenCalledWith("dark");
  });
});
