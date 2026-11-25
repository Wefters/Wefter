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

function rows(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(".wd-trow")];
}

function chip(panel: HTMLElement, value: string): HTMLElement {
  return panel.querySelector<HTMLElement>(`.wd-chip[data-value="${value}"]`)!;
}

function key(el: HTMLElement, name: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

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
    expect(rows(createBridgeInspectorPanel(store, vi.fn())).length).toBe(2);
  });

  it("lists calls chronologically, oldest first, like a log", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "1", method: "first" },
      { ...baseCall, callId: "2", method: "second" },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    const methods = [...panel.querySelectorAll(".wd-trow .wd-col-method")].map((e) => e.textContent);
    expect(methods).toEqual(["first", "second"]);
  });

  it("shows a compact one-line preview of the arguments in the row", () => {
    const store = createStore<BridgeRecord[]>([{ ...baseCall, args: { level: 0.6, animated: true } }]);
    const panel = createBridgeInspectorPanel(store, vi.fn());
    expect(panel.querySelector(".wd-cell-args")?.textContent).toBe("{level: 0.6, animated: true}");
  });

  it("opens the inspector on click and closes it on a second click", () => {
    const store = createStore<BridgeRecord[]>([{ ...baseCall, status: "success", result: { ok: true } }]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    expect(panel.querySelector(".wd-inspector-head")).toBeNull();
    rows(panel)[0]!.click();
    expect(panel.querySelector(".wd-inspector-title")?.textContent).toBe("haptics.vibrate");
    expect(panel.querySelector(".wd-inspector")?.textContent).toContain("pattern");
    expect(rows(panel)[0]!.getAttribute("aria-selected")).toBe("true");

    rows(panel)[0]!.click();
    expect(panel.querySelector(".wd-inspector-head")).toBeNull();
  });

  it("closes the inspector from its close button", () => {
    const panel = createBridgeInspectorPanel(createStore<BridgeRecord[]>([baseCall]), vi.fn());
    rows(panel)[0]!.click();
    panel.querySelector<HTMLElement>(".wd-inspector-close")!.click();
    expect(panel.querySelector(".wd-inspector-head")).toBeNull();
  });

  it("shows Arguments and Result sections, and an Error section plus callout on failure", () => {
    const ok = createBridgeInspectorPanel(
      createStore<BridgeRecord[]>([{ ...baseCall, status: "success", result: { ok: true } }]),
      vi.fn(),
    );
    rows(ok)[0]!.click();
    expect([...ok.querySelectorAll(".wd-bridge-section .wd-section-title")].map((e) => e.textContent)).toEqual([
      "Arguments",
      "Result",
    ]);

    const failed = createBridgeInspectorPanel(
      createStore<BridgeRecord[]>([{ ...baseCall, status: "error", error: { code: "E_DENIED", message: "boom" } }]),
      vi.fn(),
    );
    rows(failed)[0]!.click();
    expect(failed.querySelector(".wd-callout-code")?.textContent).toBe("E_DENIED");
    expect(failed.querySelector(".wd-bridge-section-error")?.textContent).toContain("boom");
  });

  it("says when a call is still waiting on native", () => {
    const panel = createBridgeInspectorPanel(createStore<BridgeRecord[]>([baseCall]), vi.fn());
    rows(panel)[0]!.click();
    expect(panel.querySelector(".wd-inspector")?.textContent).toContain("Waiting for the native side to respond…");
  });

  it("shows the native stack trace in its own section, and not inside the Error section", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, status: "error", error: { code: "E", message: "boom", nativeStack: "UNIQUE_STACK_TOKEN" } },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());
    rows(panel)[0]!.click();

    expect(panel.querySelector(".wd-native-stack")?.textContent).toContain("UNIQUE_STACK_TOKEN");
    expect(panel.querySelector(".wd-bridge-section-error")?.textContent).not.toContain("UNIQUE_STACK_TOKEN");
  });

  it("omits the native-stack section when there is no nativeStack on the error", () => {
    const store = createStore<BridgeRecord[]>([{ ...baseCall, status: "error", error: { code: "E", message: "x" } }]);
    const panel = createBridgeInspectorPanel(store, vi.fn());
    rows(panel)[0]!.click();
    expect(panel.querySelector(".wd-native-stack")).toBeNull();
  });

  it("applies the error accent class to failed rows (error, timeout, cancelled)", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "1", status: "error", error: { code: "E", message: "x" } },
      { ...baseCall, callId: "2", status: "timeout", error: { code: "T", message: "x" } },
      { ...baseCall, callId: "3", status: "success" },
    ]);
    const classes = rows(createBridgeInspectorPanel(store, vi.fn())).map((r) =>
      r.classList.contains("wd-row-accent-error"),
    );
    expect(classes).toEqual([true, true, false]);
  });

  it("shows a cancelled call as neutral, not as a failure", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, status: "cancelled", error: { code: "USER_CANCELLED", message: "x" } },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());
    expect(rows(panel)[0]!.classList.contains("wd-row-accent-error")).toBe(false);
    expect(panel.querySelector(".wd-trow .wd-badge")?.className).toBe("wd-badge wd-badge-cancelled");
  });

  it("selects only the clicked row, even when two records share a callId (e.g. across a reload)", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "0", method: "isDebug", timestamp: 1000, status: "success", result: { debug: true } },
      { ...baseCall, callId: "0", method: "scan", timestamp: 2000, status: "success", result: { started: true } },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    rows(panel)[1]!.click();

    expect(panel.querySelectorAll('.wd-trow[aria-selected="true"]').length).toBe(1);
    expect(panel.querySelector(".wd-inspector")?.textContent).toContain("started");
  });

  it("filters by plugin via the plugin <select>", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "1", plugin: "haptics" },
      { ...baseCall, callId: "2", plugin: "clipboard" },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());

    const pluginSelect = panel.querySelector("select") as HTMLSelectElement;
    pluginSelect.value = "clipboard";
    pluginSelect.dispatchEvent(new Event("change"));

    expect(rows(panel).length).toBe(1);
    expect(panel.querySelector(".wd-trow .wd-col-plugin")?.textContent).toBe("clipboard");
  });

  it("filters by status with the chips, where Failed covers error, timeout and cancelled", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "1", status: "success" },
      { ...baseCall, callId: "2", status: "error", error: { code: "E", message: "x" } },
      { ...baseCall, callId: "3", status: "cancelled", error: { code: "C", message: "x" } },
      { ...baseCall, callId: "4", status: "pending" },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());
    expect(chip(panel, "failed").querySelector(".wd-chip-count")?.textContent).toBe("2");

    chip(panel, "failed").click();
    expect(rows(panel).length).toBe(2);
    expect(chip(panel, "failed").getAttribute("aria-checked")).toBe("true");

    chip(panel, "pending").click();
    expect(rows(panel).length).toBe(1);
  });

  it("filters by text across plugin.method and summarises the visible calls", () => {
    const store = createStore<BridgeRecord[]>([
      { ...baseCall, callId: "1", plugin: "scanner", method: "scan", status: "success" },
      {
        ...baseCall,
        callId: "2",
        plugin: "device",
        method: "getInfo",
        status: "error",
        error: { code: "E", message: "x" },
      },
      { ...baseCall, callId: "3", plugin: "__system", method: "isDebug", status: "pending" },
    ]);
    const panel = createBridgeInspectorPanel(store, vi.fn());
    expect(panel.querySelector(".wd-summary")?.textContent).toBe("3 calls · 1 failed · 1 pending");

    const search = panel.querySelector<HTMLInputElement>(".wd-search")!;
    search.value = "scanner.sc";
    search.dispatchEvent(new Event("input"));

    expect(rows(panel).length).toBe(1);
    expect(panel.querySelector(".wd-trow .wd-col-method")?.textContent).toBe("scan");
    expect(panel.querySelector(".wd-summary")?.textContent).toBe("1 of 3 calls");
  });

  it("shows a no-match empty state when filters hide every call", () => {
    const panel = createBridgeInspectorPanel(createStore<BridgeRecord[]>([baseCall]), vi.fn());
    const search = panel.querySelector<HTMLInputElement>(".wd-search")!;
    search.value = "nothing-matches";
    search.dispatchEvent(new Event("input"));
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("No calls match the filters.");
  });

  it("re-renders live when the store updates, and keeps the inspector on the same call as it resolves", async () => {
    const store = createStore<BridgeRecord[]>([baseCall]);
    const panel = createBridgeInspectorPanel(store, vi.fn());
    rows(panel)[0]!.click();
    expect(panel.querySelector(".wd-inspector")?.textContent).toContain("Waiting for the native side");

    store.set((records) => [{ ...records[0]!, status: "success", result: { resolved: 42 }, durationMs: 7 }]);
    await flush();

    expect(panel.querySelector(".wd-inspector")?.textContent).toContain("resolved");
    expect(panel.querySelector(".wd-trow .wd-duration-text")?.textContent).toBe("7 ms");
  });

  it("pauses the live view and shows how many calls arrived meanwhile", async () => {
    const store = createStore<BridgeRecord[]>([baseCall]);
    const panel = createBridgeInspectorPanel(store, vi.fn());
    const pause = panel.querySelector<HTMLElement>(".wd-pause-btn")!;

    pause.click();
    store.set((records) => [...records, { ...baseCall, callId: "2" }, { ...baseCall, callId: "3" }]);
    await flush();
    expect(rows(panel).length).toBe(1);
    expect(pause.textContent).toBe("Resume · 2 new");
    expect(pause.getAttribute("aria-pressed")).toBe("true");

    pause.click();
    expect(rows(panel).length).toBe(3);
  });

  it("calls onClear when the Clear button is clicked", () => {
    const onClear = vi.fn();
    const panel = createBridgeInspectorPanel(createStore<BridgeRecord[]>([baseCall]), onClear);
    (panel.querySelector(".wd-clear-btn") as HTMLElement).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  describe("keyboard", () => {
    function mount(records: BridgeRecord[]) {
      const panel = createBridgeInspectorPanel(createStore<BridgeRecord[]>(records), vi.fn());
      document.body.appendChild(panel);
      return panel;
    }
    const three = [
      { ...baseCall, callId: "1", method: "a" },
      { ...baseCall, callId: "2", method: "b" },
      { ...baseCall, callId: "3", method: "c" },
    ];

    it("keeps exactly one row tabbable", () => {
      const panel = mount(three);
      expect(rows(panel).filter((r) => r.tabIndex === 0).length).toBe(1);
      panel.remove();
    });

    it("opens and closes the inspector with Enter / Space and keeps the row focused", () => {
      const panel = mount([{ ...baseCall, status: "success", result: { ok: true } }]);
      key(rows(panel)[0]!, "Enter");
      expect(rows(panel)[0]!.getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(rows(panel)[0]);

      key(rows(panel)[0]!, " ");
      expect(rows(panel)[0]!.getAttribute("aria-selected")).toBe("false");
      panel.remove();
    });

    it("moves with the arrow keys, and the open inspector follows the focused row", () => {
      const panel = mount(three);
      rows(panel)[0]!.focus();
      key(rows(panel)[0]!, "Enter");
      key(document.activeElement as HTMLElement, "ArrowDown");

      expect((document.activeElement as HTMLElement).dataset.key).toBe("2@1000");
      expect(panel.querySelector(".wd-inspector-title")?.textContent).toBe("haptics.b");

      key(document.activeElement as HTMLElement, "End");
      expect(panel.querySelector(".wd-inspector-title")?.textContent).toBe("haptics.c");
      panel.remove();
    });

    it("closes the inspector with Escape", () => {
      const panel = mount(three);
      rows(panel)[1]!.click();
      key(rows(panel)[1]!, "Escape");
      expect(panel.querySelector(".wd-inspector-head")).toBeNull();
      panel.remove();
    });

    it("keeps focus on the same row when new calls stream in", async () => {
      const store = createStore<BridgeRecord[]>(three);
      const panel = createBridgeInspectorPanel(store, vi.fn());
      document.body.appendChild(panel);
      rows(panel)[1]!.focus();

      store.set((records) => [...records, { ...baseCall, callId: "4", method: "d" }]);
      await flush();

      expect((document.activeElement as HTMLElement).dataset.key).toBe("2@1000");
      panel.remove();
    });
  });
});
