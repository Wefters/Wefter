/**
 * Building blocks shared by the panels: badges, formatting, toolbar controls, inspector sections and
 * JSON viewers.
 */

import { h } from "../dom.js";
import { icon, type IconName } from "../icons.js";

/** A coloured badge for a status such as `success` or `timeout`. */
export function statusBadge(status: string): HTMLElement {
  return h("span", { class: `wd-badge wd-badge-${status}` }, status);
}

/** Clock time with milliseconds, for example `14:03:12.084`. */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleTimeString(undefined, { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

/** `420 ms`, `1.25 s` or `12.4 s`; empty for an unknown duration. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Pretty-printed JSON, falling back to `String(value)`. */
export function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Parses JSON text, returning the text unchanged when it is not JSON. */
export function tryParseJson(text: string | undefined): unknown {
  if (!text) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Row accent class for a status: success, pending, or error. */
export function statusAccentClass(status: string): string {
  if (status === "success") return "wd-row-accent-success";
  if (status === "pending") return "wd-row-accent-pending";
  return "wd-row-accent-error";
}

/** A chevron that rotates when `isOpen`. */
export function expandChevron(isOpen: boolean): HTMLElement {
  return h("span", { class: `wd-chevron${isOpen ? " open" : ""}` }, icon("chevron"));
}

/**
 * A toolbar button with an icon. Without `showLabel` the label is only used as its tooltip and
 * accessible name.
 */
export function iconButton(
  name: IconName,
  label: string,
  onClick: (event: Event) => void,
  options: { className?: string; showLabel?: boolean } = {},
): HTMLButtonElement {
  return h(
    "button",
    {
      type: "button",
      class: `wd-btn${options.showLabel ? "" : " wd-btn-icon"}${options.className ? ` ${options.className}` : ""}`,
      title: label,
      "aria-label": options.showLabel ? undefined : label,
      onclick: onClick,
    },
    icon(name),
    options.showLabel ? h("span", { class: "wd-btn-label" }, label) : null,
  );
}

/** The toolbar's "Clear" button. */
export function clearButton(onClear: () => void): HTMLElement {
  return iconButton("clear", "Clear", () => onClear(), { className: "wd-clear-btn", showLabel: true });
}

/** Copies `getText()` to the clipboard and briefly shows "Copied". */
export function copyButton(getText: () => string): HTMLElement {
  const label = h("span", { class: "wd-btn-label" }, "Copy");
  const btn = h("button", { type: "button", class: "wd-btn wd-btn-ghost wd-copy-btn" }, icon("copy"), label);
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    navigator.clipboard.writeText(getText()).then(
      () => {
        label.textContent = "Copied";
        btn.classList.add("done");
        setTimeout(() => {
          label.textContent = "Copy";
          btn.classList.remove("done");
        }, 1200);
      },
      () => {},
    );
  });
  return btn;
}

/** A filter input. Reports lower-cased, trimmed text; Esc clears it. */
export function searchField(placeholder: string, onInput: (value: string) => void): HTMLElement {
  const input = h("input", {
    type: "search",
    class: "wd-search",
    placeholder,
    "aria-label": placeholder.replace(/…$/, ""),
    spellcheck: "false",
    autocomplete: "off",
    oninput: (e) => onInput((e.target as HTMLInputElement).value.trim().toLowerCase()),
    onkeydown: (e) => {
      const input = e.target as HTMLInputElement;
      if ((e as KeyboardEvent).key === "Escape" && input.value) {
        e.stopPropagation();
        input.value = "";
        onInput("");
      }
    },
  });
  return h("label", { class: "wd-search-field" }, icon("search"), input);
}

/** One option of a {@link chipGroup}. */
export interface Chip {
  value: string;
  label: string;
  tone?: "error" | "warn";
}

/** A chip group and a way to update the counts on its chips. */
export interface ChipGroup {
  element: HTMLElement;
  setCounts(counts: Record<string, number>): void;
}

/**
 * A single-choice row of filter chips, navigable with the arrow keys.
 *
 * @param label Accessible name of the group.
 * @param onChange Called with the chosen chip's value.
 */
export function chipGroup(label: string, chips: Chip[], onChange: (value: string) => void): ChipGroup {
  let current = chips[0]?.value ?? "";
  const countEls = new Map<string, HTMLElement>();
  const buttons: HTMLButtonElement[] = [];
  const group = h("div", { class: "wd-chips", role: "radiogroup", "aria-label": label });

  /** Marks the chip with `value` as chosen. */
  function select(value: string, focus: boolean): void {
    current = value;
    for (const btn of buttons) {
      const on = btn.dataset.value === value;
      btn.setAttribute("aria-checked", String(on));
      btn.tabIndex = on ? 0 : -1;
      if (on && focus) btn.focus();
    }
    onChange(value);
  }

  chips.forEach((chip, index) => {
    const count = h("span", { class: "wd-chip-count" });
    countEls.set(chip.value, count);
    const btn = h(
      "button",
      {
        type: "button",
        role: "radio",
        class: `wd-chip${chip.tone ? ` wd-chip-${chip.tone}` : ""}`,
        "data-value": chip.value,
        "aria-checked": String(chip.value === current),
        tabindex: chip.value === current ? "0" : "-1",
        onclick: () => select(chip.value, false),
        onkeydown: (e) => {
          const key = (e as KeyboardEvent).key;
          const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const next = chips[(index + step + chips.length) % chips.length]!;
          select(next.value, true);
        },
      },
      chip.label,
      count,
    );
    buttons.push(btn);
    group.appendChild(btn);
  });

  return {
    element: group,
    setCounts(counts) {
      for (const [value, el] of countEls) {
        const n = counts[value] ?? 0;
        el.textContent = n ? String(n) : "";
      }
    },
  };
}

/** The pause button and its state. */
export interface PauseControl {
  element: HTMLButtonElement;
  isPaused(): boolean;
  setPending(count: number): void;
}

/**
 * A button that freezes the live view. While paused, {@link PauseControl.setPending} shows how many
 * new records are waiting.
 */
export function pauseControl(onToggle: (paused: boolean) => void): PauseControl {
  let paused = false;
  const label = h("span", { class: "wd-btn-label" }, "Pause");
  const btn = h(
    "button",
    {
      type: "button",
      class: "wd-btn wd-pause-btn",
      "aria-pressed": "false",
      title: "Pause the live view",
      onclick: () => {
        paused = !paused;
        btn.setAttribute("aria-pressed", String(paused));
        btn.replaceChildren(icon(paused ? "play" : "pause"), label);
        label.textContent = paused ? "Resume" : "Pause";
        btn.title = paused ? "Resume the live view" : "Pause the live view";
        onToggle(paused);
      },
    },
    icon("pause"),
    label,
  );
  return {
    element: btn,
    isPaused: () => paused,
    setPending(count) {
      label.textContent = paused ? (count > 0 ? `Resume · ${count} new` : "Resume") : "Pause";
    },
  };
}

/** A panel toolbar. */
export function toolbar(...children: (Node | null)[]): HTMLElement {
  return h("div", { class: "wd-toolbar", role: "toolbar" }, ...children);
}

/** A vertical divider between toolbar groups. */
export function toolbarDivider(): HTMLElement {
  return h("span", { class: "wd-toolbar-divider", "aria-hidden": "true" });
}

/** Pushes the following toolbar items to the right. */
export function toolbarSpacer(): HTMLElement {
  return h("span", { class: "wd-toolbar-spacer" });
}

/** A centred message for a panel or list with nothing to show. */
export function emptyState(title: string, hint?: string, iconName: IconName = "empty"): HTMLElement {
  return h(
    "div",
    { class: "wd-empty-state" },
    icon(iconName, "wd-icon wd-empty-icon"),
    h("div", { class: "wd-empty" }, title),
    hint ? h("div", { class: "wd-empty-hint" }, hint) : null,
  );
}

/** A titled section of the details pane, with an optional copy button and error styling. */
export function inspectorSection(
  title: string,
  content: Node,
  options: { copy?: () => string; tone?: "error"; className?: string } = {},
): HTMLElement {
  return h(
    "section",
    {
      class: `wd-section${options.tone ? ` wd-section-${options.tone}` : ""}${options.className ? ` ${options.className}` : ""}`,
    },
    h(
      "header",
      { class: "wd-section-head" },
      h("h3", { class: "wd-section-title" }, title),
      options.copy ? copyButton(options.copy) : null,
    ),
    h("div", { class: "wd-section-body" }, content),
  );
}

/** A definition list of labels and values. */
export function keyValueList(entries: [string, Node | string][]): HTMLElement {
  const dl = h("dl", { class: "wd-kv" });
  for (const [key, value] of entries) dl.append(h("dt", null, key), h("dd", null, value));
  return dl;
}

/** A duration with a bar showing it relative to the slowest visible record. */
export function durationCell(durationMs: number | undefined, pending: boolean, maxDurationMs: number): HTMLElement {
  const ratio = pending || durationMs === undefined ? 0 : Math.max(0.02, Math.min(1, durationMs / maxDurationMs));
  return h(
    "span",
    { class: "wd-cell wd-cell-duration" },
    h(
      "span",
      { class: `wd-bar${pending ? " pending" : ""}`, "aria-hidden": "true" },
      h("span", { class: "wd-bar-fill", style: `--w:${ratio.toFixed(3)}` }),
    ),
    h("span", { class: "wd-duration-text" }, pending ? "…" : formatDuration(durationMs)),
  );
}

/** Secondary text, for example "None declared". */
export function mutedText(text: string): HTMLElement {
  return h("div", { class: "wd-muted" }, text);
}

/** Whether a value is an object or array. */
function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

/** Colour class of a primitive in the JSON viewers. */
function primitiveClass(value: unknown): string {
  if (typeof value === "string") return "wd-json-string";
  if (typeof value === "number" || typeof value === "bigint") return "wd-json-number";
  if (value === undefined) return "wd-json-undefined";
  return "wd-json-literal";
}

/** How a primitive is written in a preview: strings quoted, `undefined` spelled out. */
function primitiveText(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  return String(value);
}

/**
 * One-line preview of a value, such as `{ id: 1, tags: […2] }`. Shows the first six entries, writes
 * nested containers in short form, and is cut at `maxLength` characters.
 */
export function compactPreview(value: unknown, maxLength = 140, depth = 0): string {
  let text: string;
  if (Array.isArray(value)) {
    if (depth > 0) text = value.length ? `[…${value.length}]` : "[]";
    else {
      const items = value.slice(0, 6).map((v) => compactPreview(v, maxLength, depth + 1));
      text = `[${items.join(", ")}${value.length > 6 ? ", …" : ""}]`;
    }
  } else if (isContainer(value)) {
    const keys = Object.keys(value);
    if (depth > 0) text = keys.length ? "{…}" : "{}";
    else {
      const parts = keys
        .slice(0, 6)
        .map((k) => `${k}: ${compactPreview((value as Record<string, unknown>)[k], maxLength, depth + 1)}`);
      text = `{${parts.join(", ")}${keys.length > 6 ? ", …" : ""}}`;
    }
  } else {
    text = primitiveText(value);
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** A coloured preview of a value. */
function previewSpan(value: unknown): HTMLElement {
  return h("span", { class: isContainer(value) ? "wd-tree-preview" : primitiveClass(value) }, compactPreview(value));
}

/**
 * One row of a JSON tree. Children are only built when a node is first opened, so large payloads stay
 * fast; nodes shallower than `expandDepth` start open.
 */
function treeNode(key: string | null, value: unknown, depth: number, expandDepth: number): HTMLElement {
  const keyEl = key === null ? null : h("span", { class: "wd-json-key" }, key);
  const colon = key === null ? null : h("span", { class: "wd-tree-colon" }, ": ");

  const entries = isContainer(value) ? Object.entries(value) : [];
  if (!isContainer(value) || entries.length === 0 || depth > 40) {
    return h("div", { class: "wd-tree-leaf" }, keyEl, colon, previewSpan(value));
  }

  const details = h("details", { class: "wd-tree-node" });
  const children = h("div", { class: "wd-tree-children" });
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    for (const [k, v] of entries) children.appendChild(treeNode(k, v, depth + 1, expandDepth));
  };
  const summary = h(
    "summary",
    { onclick: (e) => e.stopPropagation() },
    icon("chevron", "wd-icon wd-tree-caret"),
    keyEl,
    colon,
    h(
      "span",
      { class: "wd-tree-preview" },
      Array.isArray(value) ? `Array(${value.length}) ` : "",
      compactPreview(value),
    ),
  );
  details.append(summary, children);
  details.addEventListener("toggle", build);
  if (depth < expandDepth) {
    details.open = true;
    build();
  }
  return details;
}

/** An expandable JSON tree of `value`. */
export function jsonTree(value: unknown, options: { expandDepth?: number } = {}): HTMLElement {
  return h("div", { class: "wd-tree" }, treeNode(null, value, 0, options.expandDepth ?? 1));
}

/** Matches strings (and object keys), literals and numbers in pretty-printed JSON. */
const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Pretty-printed JSON with syntax colouring. */
export function jsonView(value: unknown): HTMLElement {
  const text = jsonPreview(value);
  const pre = h("pre", { class: "wd-json" });
  let last = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) pre.appendChild(document.createTextNode(text.slice(last, index)));
    const [whole, str, colon, literal, num] = match;
    if (str !== undefined) {
      pre.appendChild(h("span", { class: colon ? "wd-json-key" : "wd-json-string" }, str));
      if (colon) pre.appendChild(document.createTextNode(colon));
    } else if (literal !== undefined) {
      pre.appendChild(h("span", { class: "wd-json-literal" }, literal));
    } else if (num !== undefined) {
      pre.appendChild(h("span", { class: "wd-json-number" }, num));
    } else {
      pre.appendChild(document.createTextNode(whole));
    }
    last = index + whole.length;
  }
  if (last < text.length) pre.appendChild(document.createTextNode(text.slice(last)));
  return pre;
}

/** Shows any value: a tree for objects, a preformatted block for multi-line text, else a single line. */
export function valueView(value: unknown, expandDepth = 2): HTMLElement {
  if (isContainer(value)) return jsonTree(value, { expandDepth });
  if (typeof value === "string" && value.includes("\n")) return h("pre", { class: "wd-pre" }, value);
  return h("div", { class: "wd-tree" }, h("div", { class: "wd-tree-leaf" }, previewSpan(value)));
}
