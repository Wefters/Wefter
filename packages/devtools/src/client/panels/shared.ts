import { h } from "../dom.js";
import { icon, type IconName } from "../icons.js";

export function statusBadge(status: string): HTMLElement {
  return h("span", { class: `wd-badge wd-badge-${status}` }, status);
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleTimeString(undefined, { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function tryParseJson(text: string | undefined): unknown {
  if (!text) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function statusAccentClass(status: string): string {
  if (status === "success") return "wd-row-accent-success";
  if (status === "pending") return "wd-row-accent-pending";
  return "wd-row-accent-error";
}

export function expandChevron(isOpen: boolean): HTMLElement {
  return h("span", { class: `wd-chevron${isOpen ? " open" : ""}` }, icon("chevron"));
}

// ── Buttons ──────────────────────────────────────────────────────────────────

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

export function clearButton(onClear: () => void): HTMLElement {
  return iconButton("clear", "Clear", () => onClear(), { className: "wd-clear-btn", showLabel: true });
}

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

// ── Toolbar controls ─────────────────────────────────────────────────────────

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

export interface Chip {
  value: string;
  label: string;
  tone?: "error" | "warn";
}

export interface ChipGroup {
  element: HTMLElement;
  setCounts(counts: Record<string, number>): void;
}

/** A single-choice segmented control (radio semantics) with an optional count per option. */
export function chipGroup(label: string, chips: Chip[], onChange: (value: string) => void): ChipGroup {
  let current = chips[0]?.value ?? "";
  const countEls = new Map<string, HTMLElement>();
  const buttons: HTMLButtonElement[] = [];
  const group = h("div", { class: "wd-chips", role: "radiogroup", "aria-label": label });

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

export interface PauseControl {
  element: HTMLButtonElement;
  isPaused(): boolean;
  setPending(count: number): void;
}

/** Freezes the panel's view (new events keep arriving and appear on resume). */
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

export function toolbar(...children: (Node | null)[]): HTMLElement {
  return h("div", { class: "wd-toolbar", role: "toolbar" }, ...children);
}

export function toolbarDivider(): HTMLElement {
  return h("span", { class: "wd-toolbar-divider", "aria-hidden": "true" });
}

export function toolbarSpacer(): HTMLElement {
  return h("span", { class: "wd-toolbar-spacer" });
}

export function emptyState(title: string, hint?: string, iconName: IconName = "empty"): HTMLElement {
  return h(
    "div",
    { class: "wd-empty-state" },
    icon(iconName, "wd-icon wd-empty-icon"),
    h("div", { class: "wd-empty" }, title),
    hint ? h("div", { class: "wd-empty-hint" }, hint) : null,
  );
}

// ── Inspector content ────────────────────────────────────────────────────────

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

export function keyValueList(entries: [string, Node | string][]): HTMLElement {
  const dl = h("dl", { class: "wd-kv" });
  for (const [key, value] of entries) dl.append(h("dt", null, key), h("dd", null, value));
  return dl;
}

/** Duration text plus a waterfall bar scaled against the slowest visible record. */
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

export function mutedText(text: string): HTMLElement {
  return h("div", { class: "wd-muted" }, text);
}

// ── Values ───────────────────────────────────────────────────────────────────

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

function primitiveClass(value: unknown): string {
  if (typeof value === "string") return "wd-json-string";
  if (typeof value === "number" || typeof value === "bigint") return "wd-json-number";
  if (value === undefined) return "wd-json-undefined";
  return "wd-json-literal";
}

function primitiveText(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  return String(value);
}

/** One-line, length-capped summary of any value, e.g. `{pattern: "short", ms: 20}`. */
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

function previewSpan(value: unknown): HTMLElement {
  return h("span", { class: isContainer(value) ? "wd-tree-preview" : primitiveClass(value) }, compactPreview(value));
}

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
    // Trees sit inside clickable rows (console); a toggle must not also toggle the row.
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

/** Collapsible JSON tree. Children are built lazily on first open, so large payloads stay cheap. */
export function jsonTree(value: unknown, options: { expandDepth?: number } = {}): HTMLElement {
  return h("div", { class: "wd-tree" }, treeNode(null, value, 0, options.expandDepth ?? 1));
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Syntax-highlighted, pretty-printed JSON (text nodes only, never innerHTML). */
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

/** A value as the inspector shows it: a tree for objects/arrays, a coloured literal otherwise. */
export function valueView(value: unknown, expandDepth = 2): HTMLElement {
  if (isContainer(value)) return jsonTree(value, { expandDepth });
  if (typeof value === "string" && value.includes("\n")) return h("pre", { class: "wd-pre" }, value);
  return h("div", { class: "wd-tree" }, h("div", { class: "wd-tree-leaf" }, previewSpan(value)));
}
