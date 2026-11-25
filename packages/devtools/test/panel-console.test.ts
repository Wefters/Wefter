import { describe, expect, it, vi } from "vitest";
import { createStore } from "../src/client/store.js";
import { createConsolePanel } from "../src/client/panels/console.js";
import type { ConsoleEvent } from "../src/shared/events.js";

function flush(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const baseEntry: ConsoleEvent = {
  level: "log",
  args: ["hello"],
  stack: null,
  timestamp: 1000,
};

function lines(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(".wd-console-line")];
}

describe("createConsolePanel", () => {
  it("shows the empty state with no entries", () => {
    const panel = createConsolePanel(createStore<ConsoleEvent[]>([]), vi.fn());
    expect(panel.querySelector(".wd-empty")?.textContent).toBe("No console output yet.");
  });

  it("renders args joined as text", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, args: ["a", "b"] }]);
    const panel = createConsolePanel(store, vi.fn());
    expect(panel.querySelector(".wd-console-msg")?.textContent).toBe("a b");
  });

  it("renders object args as a collapsed, expandable tree", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, args: ["user", { x: 1, nested: { y: 2 } }] }]);
    const panel = createConsolePanel(store, vi.fn());

    const tree = panel.querySelector<HTMLDetailsElement>(".wd-console-msg details")!;
    expect(tree.open).toBe(false);
    expect(tree.querySelector("summary")?.textContent).toContain("{x: 1, nested: {…}}");
  });

  it("lists output chronologically, newest at the bottom", () => {
    const store = createStore<ConsoleEvent[]>([
      { ...baseEntry, args: ["first"] },
      { ...baseEntry, args: ["second"] },
    ]);
    const panel = createConsolePanel(store, vi.fn());
    expect(lines(panel).map((l) => l.querySelector(".wd-console-msg")?.textContent)).toEqual(["first", "second"]);
  });

  it("collapses consecutive identical messages into one row with a repeat count", () => {
    const store = createStore<ConsoleEvent[]>([
      { ...baseEntry, args: ["tick"] },
      { ...baseEntry, args: ["tick"] },
      { ...baseEntry, args: ["tick"] },
      { ...baseEntry, args: ["tock"] },
    ]);
    const panel = createConsolePanel(store, vi.fn());
    expect(lines(panel).length).toBe(2);
    expect(panel.querySelector(".wd-repeat")?.textContent).toBe("3");
  });

  it("does not expand on click when there is no stack trace", () => {
    const panel = createConsolePanel(createStore<ConsoleEvent[]>([baseEntry]), vi.fn());
    lines(panel)[0]!.click();
    expect(panel.querySelector(".wd-detail")).toBeNull();
  });

  it("expands to reveal the stack trace on click, and collapses on a second click", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, level: "error", stack: "Error: boom\n  at x" }]);
    const panel = createConsolePanel(store, vi.fn());
    lines(panel)[0]!.click();
    expect(panel.querySelector(".wd-detail")?.textContent).toContain("at x");
    expect(lines(panel)[0]!.getAttribute("aria-expanded")).toBe("true");

    lines(panel)[0]!.click();
    expect(panel.querySelector(".wd-detail")).toBeNull();
  });

  it("toggling an object tree does not also toggle the row's stack trace", () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, level: "error", args: [{ a: 1 }], stack: "Error" }]);
    const panel = createConsolePanel(store, vi.fn());
    panel.querySelector<HTMLElement>(".wd-console-msg summary")!.click();
    expect(panel.querySelector(".wd-detail")).toBeNull();
  });

  it("tints error and uncaught rows and labels uncaught exceptions", () => {
    const store = createStore<ConsoleEvent[]>([
      { ...baseEntry, level: "error", args: ["e"] },
      { ...baseEntry, level: "uncaught", args: ["u"] },
      { ...baseEntry, level: "warn", args: ["w"] },
    ]);
    const panel = createConsolePanel(store, vi.fn());
    const groups = [...panel.querySelectorAll(".wd-console-row")];
    expect(groups[0]!.className).toContain("wd-tone-error");
    expect(groups[1]!.className).toContain("wd-tone-error");
    expect(groups[1]!.querySelector(".wd-uncaught-tag")?.textContent).toBe("Uncaught");
    expect(groups[2]!.className).toContain("wd-tone-warn");
    expect(groups[0]!.querySelector(".wd-console-level")?.className).toContain("wd-level-error");
  });

  it("filters by level with the chips, where Errors covers error and uncaught", () => {
    const store = createStore<ConsoleEvent[]>([
      { ...baseEntry, level: "log", args: ["l"] },
      { ...baseEntry, level: "warn", args: ["w"] },
      { ...baseEntry, level: "error", args: ["e"] },
      { ...baseEntry, level: "uncaught", args: ["u"] },
    ]);
    const panel = createConsolePanel(store, vi.fn());
    const errorsChip = panel.querySelector<HTMLElement>('.wd-chip[data-value="errors"]')!;
    expect(errorsChip.querySelector(".wd-chip-count")?.textContent).toBe("2");

    errorsChip.click();
    expect(lines(panel).length).toBe(2);

    panel.querySelector<HTMLElement>('.wd-chip[data-value="warn"]')!.click();
    expect(lines(panel).length).toBe(1);
    expect(panel.querySelector(".wd-console-msg")?.textContent).toBe("w");
  });

  it("filters by search text against the rendered args, case-insensitively", () => {
    const store = createStore<ConsoleEvent[]>([
      { ...baseEntry, args: ["apple pie"] },
      { ...baseEntry, args: ["Banana split"] },
    ]);
    const panel = createConsolePanel(store, vi.fn());

    const input = panel.querySelector(".wd-search") as HTMLInputElement;
    input.value = "BANANA";
    input.dispatchEvent(new Event("input"));

    expect(lines(panel).length).toBe(1);
    expect(panel.querySelector(".wd-console-msg")?.textContent).toBe("Banana split");
  });

  it("clears the search with Escape", () => {
    const panel = createConsolePanel(createStore<ConsoleEvent[]>([{ ...baseEntry, args: ["x"] }]), vi.fn());
    const input = panel.querySelector(".wd-search") as HTMLInputElement;
    input.value = "nomatch";
    input.dispatchEvent(new Event("input"));
    expect(lines(panel).length).toBe(0);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(input.value).toBe("");
    expect(lines(panel).length).toBe(1);
  });

  it("keeps an opened object tree open while new output streams in", async () => {
    const store = createStore<ConsoleEvent[]>([{ ...baseEntry, args: [{ a: { b: 1 } }] }]);
    const panel = createConsolePanel(store, vi.fn());
    const tree = panel.querySelector<HTMLDetailsElement>(".wd-console-msg details")!;
    tree.open = true;

    store.set((entries) => [...entries, { ...baseEntry, args: ["later"] }]);
    await flush();

    expect(panel.querySelector<HTMLDetailsElement>(".wd-console-msg details")!.open).toBe(true);
  });

  it("summarises totals, errors and warnings", () => {
    const store = createStore<ConsoleEvent[]>([
      baseEntry,
      { ...baseEntry, level: "error", args: ["e"] },
      { ...baseEntry, level: "warn", args: ["w"] },
    ]);
    const panel = createConsolePanel(store, vi.fn());
    expect(panel.querySelector(".wd-summary")?.textContent).toBe("3 messages · 1 error · 1 warning");
  });

  it("calls onClear when the Clear button is clicked", () => {
    const onClear = vi.fn();
    const panel = createConsolePanel(createStore<ConsoleEvent[]>([baseEntry]), onClear);
    (panel.querySelector(".wd-clear-btn") as HTMLElement).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
