import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginsPanel } from "../src/client/panels/plugins.js";
import type { PluginInfo } from "../src/shared/events.js";

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

describe("createPluginsPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading state immediately, before the fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const panel = createPluginsPanel();
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("Loading…");
  });

  it("fetches from the plugins API route", () => {
    mockFetchOnce([]);
    createPluginsPanel();
    expect(fetch).toHaveBeenCalledWith("/__wefter-devtools/api/plugins");
  });

  it("renders a card per plugin once loaded", async () => {
    mockFetchOnce([samplePlugin, { ...samplePlugin, id: "clipboard" }]);
    const panel = createPluginsPanel();
    await flushMicrotasks();

    expect(panel.querySelectorAll(".wd-plugin-card").length).toBe(2);
    expect(panel.querySelector(".wd-plugin-card-name")?.textContent).toBe("haptics");
  });

  it("shows the plugin's methods, hooks, and events in the card", async () => {
    mockFetchOnce([samplePlugin]);
    const panel = createPluginsPanel();
    await flushMicrotasks();

    const text = panel.querySelector(".wd-plugin-card")?.textContent ?? "";
    expect(text).toContain("vibrate, impact");
    expect(text).toContain("onResume");
    expect(text).toContain("deviceShake");
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

    (panel.querySelector(".wd-clear-btn") as HTMLElement).click();
    await flushMicrotasks();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
