import type { Store } from "../store.js";
import type { ConsoleEvent } from "../../shared/events.js";
import { clear, h } from "../dom.js";
import { clearButton, copyButton, expandChevron, formatTime, jsonPreview } from "./shared.js";

const LEVELS = ["log", "info", "warn", "error", "debug", "uncaught"];
const ERROR_LEVELS = new Set(["error", "uncaught"]);

export function createConsolePanel(store: Store<ConsoleEvent[]>, onClear: () => void): HTMLElement {
  let levelFilter = "";
  let search = "";
  const expanded = new Set<number>();

  const levelSelect = h(
    "select",
    {
      onchange: (e) => {
        levelFilter = (e.target as HTMLSelectElement).value;
        render();
      },
    },
    h("option", { value: "" }, "All levels"),
    ...LEVELS.map((level) => h("option", { value: level }, level)),
  );
  const searchInput = h("input", {
    type: "text",
    placeholder: "Search…",
    oninput: (e) => {
      search = (e.target as HTMLInputElement).value.toLowerCase();
      render();
    },
  });

  const listEl = h("div", { class: "wd-list" });
  const root = h(
    "div",
    { class: "wd-panel-content" },
    h("div", { class: "wd-toolbar" }, levelSelect, searchInput, clearButton(onClear)),
    listEl,
  );

  function argsToText(args: unknown[]): string {
    return args.map((arg) => (typeof arg === "string" ? arg : jsonPreview(arg))).join(" ");
  }

  function matchesSearch(entry: ConsoleEvent): boolean {
    return !search || argsToText(entry.args).toLowerCase().includes(search);
  }

  function accentClass(level: string): string {
    if (ERROR_LEVELS.has(level)) return "wd-row-accent-error";
    if (level === "warn") return "wd-row-accent-warn";
    return "";
  }

  function renderRow(entry: ConsoleEvent, key: number): HTMLElement {
    const hasStack = Boolean(entry.stack);
    const isOpen = hasStack && expanded.has(key);

    const wrapper = h("div", { class: `wd-row-group ${accentClass(entry.level)}` });
    wrapper.appendChild(
      h(
        "div",
        {
          class: "wd-row",
          onclick: () => {
            if (!hasStack) return;
            if (isOpen) expanded.delete(key);
            else expanded.add(key);
            render();
          },
        },
        h(
          "div",
          { class: "wd-row-main" },
          hasStack ? expandChevron(isOpen) : h("span", { class: "wd-chevron-spacer" }),
          h("span", { class: `wd-col-method wd-level-${entry.level}` }, entry.level),
          h("span", {}, argsToText(entry.args)),
          h("span", { class: "wd-col-dim" }, formatTime(entry.timestamp)),
        ),
      ),
    );
    if (isOpen && entry.stack) {
      const stack = entry.stack;
      wrapper.appendChild(
        h(
          "div",
          { class: "wd-detail" },
          h(
            "div",
            { class: "wd-detail-header" },
            h("span", { class: "wd-detail-label" }, "Stack trace"),
            copyButton(() => stack),
          ),
          stack,
        ),
      );
    }
    return wrapper;
  }

  function render(): void {
    const entries = store.get();
    const filtered = entries.filter((entry) => (!levelFilter || entry.level === levelFilter) && matchesSearch(entry));
    clear(listEl);
    if (filtered.length === 0) {
      listEl.appendChild(h("div", { class: "wd-empty" }, "No console output yet."));
      return;
    }
    const reversed = filtered.slice().reverse();
    reversed.forEach((entry, idx) => listEl.appendChild(renderRow(entry, filtered.length - 1 - idx)));
  }

  store.subscribe(render);
  render();
  return root;
}
