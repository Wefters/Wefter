import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/client/store.js";
import { createBridgeInspectorPanel } from "../src/client/panels/bridge-inspector.js";
import type { BridgeRecord } from "../src/shared/events.js";

function flush(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const baseCall: BridgeRecord = {
  callId: "1",
  plugin: "haptics",
  method: "vibrate",
  args: { pattern: "short" },
  timestamp: 1000,
  status: "pending",
};

describe("createBridgeInspectorPanel", () => {
  it("shows the empty state with no records", () => {
    const panel = createBridgeInspectorPanel(createStore<BridgeRecord[]>([]), vi.fn());
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("No bridge calls yet.");
  });

  it("renders one row per record", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "1" },
      { ...baseCall, callId: "2" },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    expect(panel.querySelectorAll(".wd-row").length).toBe(2);
  });

  it("orders the newest call first", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "1", method: "first" },
      { ...baseCall, callId: "2", method: "second" },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    const rows = panel.querySelectorAll(".wd-col-method");
    expect(rows[0]?.textContent).toBe("second");
    expect(rows[1]?.textContent).toBe("first");
  });

  it("expands a row to show args/result/error JSON on click, and collapses again on a second click", () => {
    const store = createStore<BridgeRecord[]>([{ ...baseCall, result: { ok: true } }]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    expect(panel.querySelector(".wd-detail")).toBeNull();
    (panel.querySelector(".wd-row") as HTMLElement).click();
    expect(panel.querySelector(".wd-detail")?.textContent).toContain('"pattern"');

    (panel.querySelector(".wd-row") as HTMLElement).click();
    expect(panel.querySelector(".wd-detail")).toBeNull();
  });

  it("shows a separate native-stack-trace block only when error.nativeStack is present", () => {
    const withStack = createStore<BridgeRecord[]>([
      { ...baseCall, status: "error", error: { code: "E", message: "boom", nativeStack: "at Foo.bar(Foo.kt:12)" } },
    ]);
    const panel = createBridgeInspectorPanel(withStack, vi.fn());
    (panel.querySelector(".wd-row") as HTMLElement).click();

    expect(panel.querySelector(".wd-native-stack")?.textContent).toContain("at Foo.bar(Foo.kt:12)");
  });

  it("omits the native-stack block when there is no nativeStack on the error", () => {
    const noStack = createStore<BridgeRecord[]>([
      { ...baseCall, status: "error", error: { code: "E", message: "boom" } },
    ]);
    const panel = createBridgeInspectorPanel(noStack, vi.fn());
    (panel.querySelector(".wd-row") as HTMLElement).click();

    expect(panel.querySelector(".wd-native-stack")).toBeNull();
  });

  it("excludes nativeStack from the general args/result/error JSON block, to avoid duplicating it", () => {
    const withStack = createStore<BridgeRecord[]>([
      { ...baseCall, status: "error", error: { code: "E", message: "boom", nativeStack: "UNIQUE_STACK_TOKEN" } },
    ]);
    const panel = createBridgeInspectorPanel(withStack, vi.fn());
    (panel.querySelector(".wd-row") as HTMLElement).click();

    const details = panel.querySelectorAll(".wd-detail");
    expect(details[0]?.textContent).not.toContain("UNIQUE_STACK_TOKEN");
    expect(details[1]?.textContent).toContain("UNIQUE_STACK_TOKEN");
  });

  it("applies the error accent class to the row group for error records", () => {
    const store = createStore<BridgeRecord[]>([{ ...baseCall, status: "error", error: { code: "E", message: "x" } }]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    expect(panel.querySelector(".wd-row-group")?.className).toContain("wd-row-accent-error");
  });

  it("filters by plugin via the plugin <select>", async () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "1", plugin: "haptics" },
      { ...baseCall, callId: "2", plugin: "clipboard" },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    const pluginSelect = panel.querySelectorAll("select")[0] as HTMLSelectElement;
    pluginSelect.value = "clipboard";
    pluginSelect.dispatchEvent(new Event("change"));

    const rows = panel.querySelectorAll(".wd-row");
    expect(rows.length).toBe(1);
    expect(panel.querySelector(".wd-col-plugin")?.textContent).toBe("clipboard");
  });

  it("filters by status via the status <select>", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "1", status: "success" },
      { ...baseCall, callId: "2", status: "error", error: { code: "E", message: "x" } },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    const statusSelect = panel.querySelectorAll("select")[1] as HTMLSelectElement;
    statusSelect.value = "error";
    statusSelect.dispatchEvent(new Event("change"));

    expect(panel.querySelectorAll(".wd-row").length).toBe(1);
  });

  it("re-renders live when the store updates", async () => {
    const store = createStore<BridgeRecord[]>([]);
    const panel = createBridgeInspectorPanel(store, vi.fn());
    expect(panel.querySelectorAll(".wd-row").length).toBe(0);

    store.set(() => [baseCall]);
    await flush();

    expect(panel.querySelectorAll(".wd-row").length).toBe(1);
  });

  it("calls onClear when the Clear button is clicked", () => {
    const onClear = vi.fn();
    const panel = createBridgeInspectorPanel(createStore<BridgeRecord[]>([baseCall]), onClear);
    (panel.querySelector(".wd-clear-btn") as HTMLElement).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
