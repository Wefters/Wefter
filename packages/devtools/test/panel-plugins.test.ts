import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../src/client/store.js";
import { createPluginsPanel } from "../src/client/panels/plugins.js";
import type { BridgeRecord, PluginInfo } from "../src/shared/events.js";

const samplePlugin: PluginInfo = {
  id: "haptics",
  methods: ["vibrate", "impact"],
  hooks: ["onResume"],
  events: ["deviceShake"],
  androidPermissions: ["VIBRATE"],
  iosPermissions: [],
  hasAndroidSource: true,
  hasIosSource: false,
};

function mockFetchOnce(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: () => Promise.resolve(body),
    }),
  );
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function rows(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(".wd-trow")];
}

describe("createPluginsPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state immediately, before the fetch resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const panel = createPluginsPanel();
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("Loading…");
  });

  it("fetches from the plugins API route", () => {
    mockFetchOnce([]);
    createPluginsPanel();
    expect(fetch).toHaveBeenCalledWith("/__wefter-devtools/api/plugins");
  });

  it("renders a row per plugin with its name, platforms and methods", async () => {
    mockFetchOnce([samplePlugin, { ...samplePlugin, id: "clipboard" }]);
    const panel = createPluginsPanel();
    await flushMicrotasks();

    expect(rows(panel).length).toBe(2);
    const first = rows(panel)[0]!;
    expect(first.querySelector(".wd-plugin-name")?.textContent).toBe("haptics");
    expect(first.querySelector(".wd-cell-args")?.textContent).toBe("vibrate, impact");
    const pills = [...first.querySelectorAll(".wd-platform")].map(
      (p) => `${p.textContent}:${p.classList.contains("on")}`,
    );
    expect(pills).toEqual(["iOS:false", "Android:true"]);
  });

  it("opens the plugin's methods, hooks, events and permissions in the inspector", async () => {
    mockFetchOnce([samplePlugin]);
    const panel = createPluginsPanel();
    await flushMicrotasks();
    rows(panel)[0]!.click();

    const titles = [...panel.querySelectorAll(".wd-section-title")].map((t) => t.textContent);
    expect(titles).toEqual(["Overview", "Methods", "Hooks", "Events", "Permissions"]);
    const tags = [...panel.querySelectorAll(".wd-inspector .wd-tag")].map((t) => t.textContent);
    expect(tags).toEqual(["vibrate", "impact", "onResume", "deviceShake", "VIBRATE"]);
  });

  it("shows an empty-config message when the plugin list is empty", async () => {
    mockFetchOnce([]);
    const panel = createPluginsPanel();
    await flushMicrotasks();

    expect(panel.querySelector(".wd-empty")?.textContent).toBe("No plugins configured in wefter.config.json.");
  });

  it("shows an error message when the fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const panel = createPluginsPanel();
    await flushMicrotasks();

    expect(panel.querySelector(".wd-empty")?.textContent).toBe("Failed to load the plugin catalog.");
  });

  it("re-fetches when the Refresh button is clicked", async () => {
    mockFetchOnce([samplePlugin]);
    const panel = createPluginsPanel();
    await flushMicrotasks();
    expect(fetch).toHaveBeenCalledTimes(1);

    (panel.querySelector(".wd-refresh-btn") as HTMLElement).click();
    await flushMicrotasks();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("filters plugins by name, method or event", async () => {
    mockFetchOnce([samplePlugin, { ...samplePlugin, id: "clipboard", methods: ["read"], events: [] }]);
    const panel = createPluginsPanel();
    await flushMicrotasks();

    const input = panel.querySelector(".wd-search") as HTMLInputElement;
    input.value = "shake";
    input.dispatchEvent(new Event("input"));

    expect(rows(panel).map((r) => r.querySelector(".wd-plugin-name")?.textContent)).toEqual(["haptics"]);
    expect(panel.querySelector(".wd-summary")?.textContent).toBe("1 of 2 plugins");
  });

  it("shows this session's call count per plugin when given the bridge store", async () => {
    mockFetchOnce([samplePlugin]);
    const bridgeStore = createStore<BridgeRecord[]>([
      { callId: "1", plugin: "haptics", method: "vibrate", args: {}, timestamp: 1, status: "success" },
      { callId: "2", plugin: "haptics", method: "impact", args: {}, timestamp: 2, status: "error" },
    ]);
    const panel = createPluginsPanel(bridgeStore);
    await flushMicrotasks();

    expect(panel.querySelector(".wd-plugin-calls")?.textContent).toBe("2 · 1 failed");
  });
});
