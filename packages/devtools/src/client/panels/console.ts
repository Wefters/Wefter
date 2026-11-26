/**
 * The Console panel: console output and uncaught errors from the app, in order, with repeated messages
 * grouped.
 */

import type { Store } from "../store.js";
import type { ConsoleEvent } from "../../shared/events.js";
import { h } from "../dom.js";
import { icon, type IconName } from "../icons.js";
import {
  chipGroup,
  clearButton,
  copyButton,
  emptyState,
  expandChevron,
  formatTime,
  jsonPreview,
  jsonTree,
  pauseControl,
  searchField,
  toolbar,
  toolbarDivider,
  toolbarSpacer,
} from "./shared.js";

/** Levels shown as errors. */
const ERROR_LEVELS = new Set(["error", "uncaught"]);

/** What each level filter chip lets through. */
const LEVEL_GROUPS: Record<string, (level: string) => boolean> = {
  "": () => true,
  errors: (level) => ERROR_LEVELS.has(level),
  warn: (level) => level === "warn",
  info: (level) => level === "info",
  log: (level) => level === "log",
  debug: (level) => level === "debug",
};

/** Icon shown next to entries of a level. */
const LEVEL_ICON: Partial<Record<string, IconName>> = {
  error: "error",
  uncaught: "error",
  warn: "warn",
  info: "info",
};

/** Plain-text form of an entry's arguments, used for searching, grouping and copying. */
function argsToText(args: unknown[]): string {
  return args.map((arg) => (typeof arg === "string" ? arg : jsonPreview(arg))).join(" ");
}

/** Renders one argument: text as is, objects as a collapsed tree. */
function renderArg(arg: unknown): Node {
  if (typeof arg === "string") return document.createTextNode(arg);
  if (typeof arg === "object" && arg !== null) {
    const tree = jsonTree(arg, { expandDepth: 0 });
    tree.classList.add("wd-tree-inline");
    return tree;
  }
  const cls = typeof arg === "number" ? "wd-json-number" : arg === undefined ? "wd-json-undefined" : "wd-json-literal";
  return h("span", { class: cls }, String(arg));
}

/** Consecutive identical entries shown as one row with a count. */
interface Group {
  entry: ConsoleEvent;
  count: number;
  text: string;
}

/**
 * Creates the Console panel, with level filters, a text filter and a pause button.
 *
 * @param onClear Asks the server to clear the console history.
 */
export function createConsolePanel(store: Store<ConsoleEvent[]>, onClear: () => void): HTMLElement {
  let levelFilter = "";
  let search = "";
  let snapshot: ConsoleEvent[] | null = null;
  const rowCache = new WeakMap<ConsoleEvent, { el: HTMLElement; count: HTMLElement }>();
  const openStacks = new WeakSet<ConsoleEvent>();

  const pause = pauseControl((paused) => {
    snapshot = paused ? store.get() : null;
    render();
  });
  const levels = chipGroup(
    "Filter by level",
    [
      { value: "", label: "All" },
      { value: "errors", label: "Errors", tone: "error" },
      { value: "warn", label: "Warnings", tone: "warn" },
      { value: "info", label: "Info" },
      { value: "log", label: "Logs" },
      { value: "debug", label: "Debug" },
    ],
    (value) => {
      levelFilter = value;
      render();
    },
  );
  const summaryEl = h("span", { class: "wd-summary", "aria-live": "polite" });
  const listEl = h("div", { class: "wd-list wd-console", role: "log", "aria-label": "Console output" });

  const root = h(
    "div",
    { class: "wd-panel-content" },
    toolbar(
      pause.element,
      clearButton(onClear),
      toolbarDivider(),
      searchField("Filter output…", (value) => {
        search = value;
        render();
      }),
      levels.element,
      toolbarSpacer(),
      summaryEl,
    ),
    listEl,
  );

  /** Shows or hides an entry's stack trace. */
  function toggleStack(entry: ConsoleEvent): void {
    if (openStacks.has(entry)) openStacks.delete(entry);
    else openStacks.add(entry);
    rowCache.delete(entry);
    render();
    const row = rowCache.get(entry)?.el.querySelector<HTMLElement>(".wd-row");
    row?.focus();
  }

  /** Builds the row for a group. Rows are cached per entry so live updates only build new ones. */
  function buildRow(group: Group): { el: HTMLElement; count: HTMLElement } {
    const { entry } = group;
    const hasStack = Boolean(entry.stack);
    const isOpen = hasStack && openStacks.has(entry);
    const level = entry.level;
    const levelIcon = LEVEL_ICON[level];
    const count = h("span", { class: "wd-repeat", title: "Repeated" });

    const row = h(
      "div",
      {
        class: "wd-row wd-console-line",
        role: hasStack ? "button" : undefined,
        tabindex: hasStack ? "0" : undefined,
        "aria-expanded": hasStack ? String(isOpen) : undefined,
        onclick: () => {
          if (hasStack) toggleStack(entry);
        },
        onkeydown: (e) => {
          const key = (e as KeyboardEvent).key;
          if (hasStack && (key === "Enter" || key === " ")) {
            e.preventDefault();
            toggleStack(entry);
          }
        },
      },
      hasStack ? expandChevron(isOpen) : h("span", { class: "wd-chevron-spacer" }),
      h(
        "span",
        { class: `wd-console-level wd-level-${level}`, title: level },
        levelIcon ? icon(levelIcon) : h("span", { class: "wd-level-tag" }, level === "uncaught" ? "!" : ""),
      ),
      count,
      h(
        "span",
        { class: "wd-console-msg" },
        level === "uncaught" ? h("span", { class: "wd-uncaught-tag" }, "Uncaught") : null,
        ...entry.args.flatMap((arg, i) =>
          i === 0 ? [renderArg(arg)] : [document.createTextNode(" "), renderArg(arg)],
        ),
      ),
      h(
        "span",
        { class: "wd-console-actions" },
        copyButton(() => (entry.stack ? `${group.text}\n${entry.stack}` : group.text)),
      ),
      h("span", { class: "wd-col-dim wd-console-time" }, formatTime(entry.timestamp)),
    );

    const tone = ERROR_LEVELS.has(level) ? " wd-tone-error" : level === "warn" ? " wd-tone-warn" : "";
    const el = h("div", { class: `wd-row-group wd-console-row${tone}${isOpen ? " open" : ""}` }, row);
    if (isOpen && entry.stack) {
      el.appendChild(
        h("div", { class: "wd-detail wd-console-stack" }, h("pre", { class: "wd-pre wd-stack" }, entry.stack)),
      );
    }
    return { el, count };
  }

  /** Applies the filters, groups repeats and updates the list. */
  function render(): void {
    const live = store.get();
    const entries = snapshot ?? live;
    pause.setPending(snapshot ? Math.max(0, live.length - snapshot.length) : 0);

    const searched = search ? entries.filter((e) => argsToText(e.args).toLowerCase().includes(search)) : entries;
    const counts: Record<string, number> = {};
    for (const [value, test] of Object.entries(LEVEL_GROUPS)) {
      if (value) counts[value] = searched.filter((e) => test(e.level)).length;
    }
    levels.setCounts(counts);
    const matches = LEVEL_GROUPS[levelFilter] ?? LEVEL_GROUPS[""]!;
    const filtered = searched.filter((e) => matches(e.level));

    const errors = entries.filter((e) => ERROR_LEVELS.has(e.level)).length;
    const warnings = entries.filter((e) => e.level === "warn").length;
    const total = filtered.length === entries.length ? `${entries.length}` : `${filtered.length} of ${entries.length}`;
    summaryEl.textContent =
      `${total} message${entries.length === 1 ? "" : "s"}` +
      (errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : "") +
      (warnings ? ` · ${warnings} warning${warnings === 1 ? "" : "s"}` : "");

    const groups: Group[] = [];
    for (const entry of filtered) {
      const text = argsToText(entry.args);
      const last = groups[groups.length - 1];
      if (last && !entry.stack && !last.entry.stack && last.entry.level === entry.level && last.text === text) {
        last.count++;
      } else {
        groups.push({ entry, count: 1, text });
      }
    }

    const stick = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 32;
    const active = listEl.ownerDocument.activeElement;
    const focusedEl = active instanceof HTMLElement && listEl.contains(active) ? active : null;
    if (groups.length === 0) {
      listEl.replaceChildren(
        entries.length === 0
          ? emptyState(
              "No console output yet.",
              "console.log, warnings, errors and uncaught exceptions from the app show up here.",
              "console",
            )
          : emptyState("No messages match the filters.", "Clear the search or pick another level.", "search"),
      );
      return;
    }
    listEl.replaceChildren(
      ...groups.map((group) => {
        let cached = rowCache.get(group.entry);
        if (!cached) {
          cached = buildRow(group);
          rowCache.set(group.entry, cached);
        }
        cached.count.textContent = group.count > 1 ? String(group.count) : "";
        return cached.el;
      }),
    );
    if (stick) listEl.scrollTop = listEl.scrollHeight;
    if (focusedEl?.isConnected) focusedEl.focus({ preventScroll: true });
  }

  store.subscribe(render);
  render();
  return root;
}
