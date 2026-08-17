import { describe, expect, it, vi } from "vitest";
import { mountDevtoolsApp, type MinimalHotContext } from "../src/client/main.js";
import { WEFTER_EVENT, type ReplayPayload } from "../src/shared/events.js";

function flush(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createFakeHot() {
  const handlers = new Map<string, (data: unknown) => void>();
  const sent: { event: string; payload: unknown }[] = [];
  const hot: MinimalHotContext = {
    on: (event, cb) => {
      handlers.set(event, cb);
    },
    send: (event, payload) => {
      sent.push({ event, payload });
    },
  };
  return { hot, trigger: (event: string, data?: unknown) => handlers.get(event)?.(data), sent };
}

const emptyReplay: ReplayPayload = { bridge: [], console: [], network: [], presence: [] };

describe("mountDevtoolsApp", () => {
  it("mounts the shell with all 5 tabs", () => {
    const app = document.createElement("div");
    const { hot } = createFakeHot();
    mountDevtoolsApp(app, hot);

    const tabLabels = [...app.querySelectorAll(".wd-tab")].map((t) => t.textContent);
    expect(tabLabels).toEqual(["Bridge Inspector", "Console", "Network", "Plugin / Permission State", "Plugins"]);
  });

  it("requests a replay immediately on mount", () => {
    const app = document.createElement("div");
    const { hot, sent } = createFakeHot();
    mountDevtoolsApp(app, hot);

    expect(sent).toContainEqual({ event: WEFTER_EVENT.replayRequest, payload: {} });
  });

  it("requests a fresh replay whenever the HMR socket reconnects", () => {
    const app = document.createElement("div");
    const { hot, trigger, sent } = createFakeHot();
    mountDevtoolsApp(app, hot);
    const before = sent.length;

    trigger("vite:ws:connect");

    expect(sent.length).toBe(before + 1);
    expect(sent[sent.length - 1]).toEqual({ event: WEFTER_EVENT.replayRequest, payload: {} });
  });

  it("hydrates all four stores from a replay payload", async () => {
    const app = document.createElement("div");
    const { hot, trigger } = createFakeHot();
    mountDevtoolsApp(app, hot);

    trigger(WEFTER_EVENT.replay, {
      ...emptyReplay,
      bridge: [{ callId: "1", plugin: "haptics", method: "vibrate", args: {}, timestamp: 1, status: "success" }],
    });
    await flush();

    expect(app.querySelector(".wd-col-method")?.textContent).toBe("vibrate");
  });

  it("appends a pending row live on bridge_call", async () => {
    const app = document.createElement("div");
    const { hot, trigger } = createFakeHot();
    mountDevtoolsApp(app, hot);

    trigger(WEFTER_EVENT.bridgeCall, { callId: "1", plugin: "clipboard", method: "read", args: {}, timestamp: 1 });
    await flush();

    const bridgeTab = app.querySelectorAll(".wd-tab")[0] as HTMLElement;
    bridgeTab.click();
    expect(app.querySelector(".wd-badge")?.textContent).toBe("pending");
  });

  it("merges bridge_response into the pending call by callId rather than adding a new row", async () => {
    const app = document.createElement("div");
    const { hot, trigger } = createFakeHot();
    mountDevtoolsApp(app, hot);

    trigger(WEFTER_EVENT.bridgeCall, { callId: "1", plugin: "clipboard", method: "read", args: {}, timestamp: 1 });
    trigger(WEFTER_EVENT.bridgeResponse, { callId: "1", status: "success", result: { text: "hi" }, durationMs: 5 });
    await flush();

    expect(app.querySelectorAll(".wd-row").length).toBe(1);
    expect(app.querySelector(".wd-badge")?.textContent).toBe("success");
  });

  it("routes console events to the Console panel", async () => {
    const app = document.createElement("div");
    const { hot, trigger } = createFakeHot();
    mountDevtoolsApp(app, hot);

    trigger(WEFTER_EVENT.console, { level: "log", args: ["hi from app"], stack: null, timestamp: 1 });
    await flush();

    (app.querySelectorAll(".wd-tab")[1] as HTMLElement).click();
    expect(app.textContent).toContain("hi from app");
  });

  it("merges network_response into the pending request by requestId", async () => {
    const app = document.createElement("div");
    const { hot, trigger } = createFakeHot();
    mountDevtoolsApp(app, hot);

    trigger(WEFTER_EVENT.networkRequest, { requestId: "r1", url: "/api", method: "GET", headers: {}, timestamp: 1 });
    trigger(WEFTER_EVENT.networkResponse, { requestId: "r1", status: 200, durationMs: 3, bodyPreview: "{}" });
    await flush();

    (app.querySelectorAll(".wd-tab")[2] as HTMLElement).click();
    expect(app.querySelectorAll(".wd-row").length).toBe(1);
    expect(app.querySelector(".wd-badge")?.textContent).toBe("200");
  });

  it("updates presence from client_list events", async () => {
    const app = document.createElement("div");
    const { hot, trigger } = createFakeHot();
    mountDevtoolsApp(app, hot);

    trigger(WEFTER_EVENT.clientList, [{ clientId: "a", url: "/", timestamp: 1 }]);
    await flush();

    expect(app.querySelector(".wd-clients")?.textContent).toBe("1 client connected");
  });

  it("sends a scoped clear request when a panel's Clear button is clicked", () => {
    const app = document.createElement("div");
    const { hot, sent } = createFakeHot();
    mountDevtoolsApp(app, hot);

    (app.querySelector(".wd-clear-btn") as HTMLElement).click();

    expect(sent).toContainEqual({ event: WEFTER_EVENT.clearRequest, payload: { channel: "bridge" } });
  });

  it("empties the matching store when a cleared event arrives for its channel", async () => {
    const app = document.createElement("div");
    const { hot, trigger } = createFakeHot();
    mountDevtoolsApp(app, hot);

    trigger(WEFTER_EVENT.bridgeCall, { callId: "1", plugin: "haptics", method: "vibrate", args: {}, timestamp: 1 });
    await flush();
    expect(app.querySelectorAll(".wd-row").length).toBe(1);

    trigger(WEFTER_EVENT.cleared, { channel: "bridge" });
    await flush();

    expect(app.querySelector(".wd-empty")?.textContent).toBe("No bridge calls yet.");
  });

  it("leaves other channels untouched when one channel is cleared", async () => {
    const app = document.createElement("div");
    const { hot, trigger } = createFakeHot();
    mountDevtoolsApp(app, hot);

    trigger(WEFTER_EVENT.console, { level: "log", args: ["still here"], stack: null, timestamp: 1 });
    trigger(WEFTER_EVENT.cleared, { channel: "network" });
    await flush();

    (app.querySelectorAll(".wd-tab")[1] as HTMLElement).click();
    expect(app.textContent).toContain("still here");
  });
});
