import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/client/store.js";
import { createConsolePanel } from "../src/client/panels/console.js";
import type { ConsoleEvent } from "../src/shared/events.js";

const baseEntry: ConsoleEvent = {
  level: "log",
  args: ["hello"],
  stack: null,
  timestamp: 1000,
};

describe("createConsolePanel", () => {
  it("shows the empty state with no entries", () => {
    const panel = createConsolePanel(createStore<ConsoleEvent[]>([]), vi.fn());
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("No console output yet.");
  });

  it("renders args joined as text", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, args: ["a", "b"] }]);
    const panel = createConsolePanel(store, vi.fn());
    expect(panel.querySelector(".wd-row")?.textContent).toContain("a b");
  });

  it("JSON-previews non-string args", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, args: [{ x: 1 }] }]);
    const panel = createConsolePanel(store, vi.fn());
    expect(panel.querySelector(".wd-row")?.textContent).toContain('"x": 1');
  });

  it("does not expand on click when there is no stack trace", () => {
    const store = createStore<ConsoleEvent[]>([baseEntry]);
    const panel = createConsolePanel(store, vi.fn());
    (panel.querySelector(".wd-row") as HTMLElement).click();
    expect(panel.querySelector(".wd-detail")).toBeNull();
  });

  it("expands to reveal the stack trace on click when one is present", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, level: "error", stack: "Error: boom\n  at x" }]);
    const panel = createConsolePanel(store, vi.fn());
    (panel.querySelector(".wd-row") as HTMLElement).click();
    expect(panel.querySelector(".wd-detail")?.textContent).toContain("at x");
  });

  it("collapses the stack trace on a second click", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, level: "error", stack: "Error: boom" }]);
    const panel = createConsolePanel(store, vi.fn());
    (panel.querySelector(".wd-row") as HTMLElement).click();
    (panel.querySelector(".wd-row") as HTMLElement).click();
    expect(panel.querySelector(".wd-detail")).toBeNull();
  });

  it("gives error and uncaught levels the level-specific class", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, level: "error" }]);
    const panel = createConsolePanel(store, vi.fn());
    expect(panel.querySelector(".wd-col-method")?.className).toContain("wd-level-error");
  });

  it("filters by level via the level <select>", () => {
    const store = createStore<ConsoleEvent[]>([
      { ...baseEntry, level: "log", args: ["l"] },
      { ...baseEntry, level: "warn", args: ["w"] },
    ]);
    const panel = createConsolePanel(store, vi.fn());

    const select = panel.querySelector("select") as HTMLSelectElement;
    select.value = "warn";
    select.dispatchEvent(new Event("change"));

    expect(panel.querySelectorAll(".wd-row").length).toBe(1);
    expect(panel.querySelector(".wd-row")?.textContent).toContain("w");
  });

  it("filters by search text against the rendered args", () => {
    const store = createStore<ConsoleEvent[]>([
      { ...baseEntry, args: ["apple pie"] },
      { ...baseEntry, args: ["banana split"] },
    ]);
    const panel = createConsolePanel(store, vi.fn());

    const input = panel.querySelector("input") as HTMLInputElement;
    input.value = "banana";
    input.dispatchEvent(new Event("input"));

    expect(panel.querySelectorAll(".wd-row").length).toBe(1);
    expect(panel.querySelector(".wd-row")?.textContent).toContain("banana split");
  });

  it("search is case-insensitive", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, args: ["Hello World"] }]);
    const panel = createConsolePanel(store, vi.fn());

    const input = panel.querySelector("input") as HTMLInputElement;
    input.value = "HELLO";
    input.dispatchEvent(new Event("input"));

    expect(panel.querySelectorAll(".wd-row").length).toBe(1);
  });

  it("calls onClear when the Clear button is clicked", () => {
    const onClear = vi.fn();
    const panel = createConsolePanel(createStore<ConsoleEvent[]>([baseEntry]), onClear);
    (panel.querySelector(".wd-clear-btn") as HTMLElement).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
