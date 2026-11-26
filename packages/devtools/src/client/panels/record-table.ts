/** A table of records with a resizable details pane, shared by the Bridge, Network and Plugins panels. */

import { h } from "../dom.js";
import { icon } from "../icons.js";

/** A column header. */
export interface TableColumn {
  label: string;
  className?: string;
}

/** What the details pane shows for a record. */
export interface InspectorContent {
  title: Node | string;
  meta?: Node | null;
  body: Node[];
}

/** How the table reads and renders its records. */
export interface RecordTableOptions<T> {
  ariaLabel: string;
  columns: TableColumn[];
  gridTemplate: string;
  keyOf(record: T): string;
  rowClass?(record: T): string;
  cells(record: T, context: { maxDurationMs: number }): Node[];
  durationOf?(record: T): number | undefined;
  inspect(record: T): InspectorContent;
  emptyState(): HTMLElement;
}

/** A mounted table. */
export interface RecordTable<T> {
  element: HTMLElement;
  setRecords(records: T[]): void;
  selectedKey(): string | null;
}

/** `localStorage` key of the details pane width. */
const INSPECTOR_WIDTH_KEY = "wefter-devtools:inspector-width";
const MIN_INSPECTOR = 280;

/** The saved details pane width, or the default. */
function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY));
    return Number.isFinite(n) && n >= MIN_INSPECTOR ? n : 440;
  } catch {
    return 440;
  }
}

/**
 * Creates a table whose rows can be selected to show their details beside it.
 *
 * - Arrow keys, Home and End move between rows; Enter or Space opens the details; Esc closes them.
 * - Selection and keyboard focus survive live updates.
 * - The list stays scrolled to the newest record while the user is at the bottom.
 * - The details pane is only rebuilt when the selected record changes.
 */
export function createRecordTable<T>(options: RecordTableOptions<T>): RecordTable<T> {
  let records: T[] = [];
  let selected: string | null = null;
  let focused: string | null = null;
  let focusAfterRender = false;
  let inspected: { key: string; record: T } | null = null;
  let inspectorWidth = storedWidth();

  const head = h(
    "div",
    { class: "wd-thead", "aria-hidden": "true" },
    ...options.columns.map((c) => h("span", { class: `wd-th${c.className ? ` ${c.className}` : ""}` }, c.label)),
  );
  const body = h("div", { class: "wd-tbody", role: "listbox", "aria-label": options.ariaLabel });
  const table = h("div", { class: "wd-table" }, head, body);
  const inspector = h("aside", { class: "wd-inspector", "aria-label": "Details" });
  const resizer = h("div", {
    class: "wd-resizer",
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize details",
    tabindex: "0",
  });
  const element = h("div", { class: "wd-split" }, table, resizer, inspector);
  element.style.setProperty("--cols", options.gridTemplate);
  element.style.setProperty("--inspector-w", `${inspectorWidth}px`);

  /**
   * Sets the details pane width, kept between the minimum and what leaves room for the table, and saves it.
   */
  function setWidth(px: number): void {
    const max = Math.max(MIN_INSPECTOR, element.clientWidth - 320);
    inspectorWidth = Math.round(Math.min(Math.max(px, MIN_INSPECTOR), max || px));
    element.style.setProperty("--inspector-w", `${inspectorWidth}px`);
    try {
      localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
    } catch {}
  }

  resizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("dragging");
    const right = element.getBoundingClientRect().right;
    const move = (e: PointerEvent) => setWidth(right - e.clientX);
    const up = () => {
      resizer.classList.remove("dragging");
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", up);
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", up);
  });
  resizer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") setWidth(inspectorWidth + 24);
    else if (event.key === "ArrowRight") setWidth(inspectorWidth - 24);
  });

  function keys(): string[] {
    return records.map(options.keyOf);
  }

  /** Selects a row (or none) and re-renders. */
  function setSelected(key: string | null, focusRow: boolean): void {
    selected = key;
    if (key) focused = key;
    focusAfterRender = focusRow;
    render();
  }

  /** Keyboard navigation inside the table. */
  function onRowKey(event: KeyboardEvent, key: string): void {
    const all = keys();
    const index = all.indexOf(key);
    let target: string | undefined;
    switch (event.key) {
      case "ArrowDown":
        target = all[Math.min(index + 1, all.length - 1)];
        break;
      case "ArrowUp":
        target = all[Math.max(index - 1, 0)];
        break;
      case "Home":
        target = all[0];
        break;
      case "End":
        target = all[all.length - 1];
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        setSelected(selected === key ? null : key, true);
        return;
      case "Escape":
        if (selected) {
          event.preventDefault();
          event.stopPropagation();
          setSelected(null, true);
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    if (!target) return;
    focused = target;
    if (selected) selected = target;
    focusAfterRender = true;
    render();
  }

  /**
   * Fills the details pane for the selected record, keeping its scroll position when the same record is
   * updated.
   */
  function renderInspector(): void {
    const record = selected === null ? undefined : records.find((r) => options.keyOf(r) === selected);
    if (!record) {
      inspected = null;
      element.classList.remove("has-inspector");
      inspector.replaceChildren();
      return;
    }
    element.classList.add("has-inspector");
    if (inspected && inspected.key === selected && inspected.record === record) return;
    const scrollTop = inspected?.key === selected ? inspector.scrollTop : 0;
    inspected = { key: selected!, record };
    const content = options.inspect(record);
    inspector.replaceChildren(
      h(
        "header",
        { class: "wd-inspector-head" },
        h("div", { class: "wd-inspector-title" }, content.title),
        content.meta ?? null,
        h(
          "button",
          {
            type: "button",
            class: "wd-btn wd-btn-icon wd-inspector-close",
            title: "Close details (Esc)",
            "aria-label": "Close details",
            onclick: () => setSelected(null, true),
          },
          icon("close"),
        ),
      ),
      h("div", { class: "wd-inspector-body" }, ...content.body),
    );
    inspector.scrollTop = scrollTop;
  }

  /** Re-renders the rows and the details pane, restoring focus and scroll position. */
  function render(): void {
    const all = keys();
    if (selected !== null && !all.includes(selected)) selected = null;
    if (focused === null || !all.includes(focused)) focused = selected ?? all[all.length - 1] ?? null;

    const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
    const active = body.ownerDocument.activeElement;
    const rowHadFocus = active instanceof HTMLElement && active.classList.contains("wd-trow") && body.contains(active);
    const maxDurationMs = Math.max(1, ...records.map((r) => options.durationOf?.(r) ?? 0));

    if (records.length === 0) {
      body.replaceChildren(options.emptyState());
    } else {
      body.replaceChildren(
        ...records.map((record) => {
          const key = options.keyOf(record);
          const isSelected = key === selected;
          return h(
            "div",
            {
              class: `wd-row wd-trow${isSelected ? " selected" : ""}${options.rowClass ? ` ${options.rowClass(record)}` : ""}`,
              role: "option",
              "aria-selected": String(isSelected),
              tabindex: key === focused ? "0" : "-1",
              "data-key": key,
              onclick: () => setSelected(isSelected ? null : key, false),
              onkeydown: (e) => onRowKey(e as KeyboardEvent, key),
              onfocus: () => {
                focused = key;
              },
            },
            ...options.cells(record, { maxDurationMs }),
          );
        }),
      );
    }
    if (stick && !selected) body.scrollTop = body.scrollHeight;

    renderInspector();

    if ((focusAfterRender || rowHadFocus) && focused) {
      const row = [...body.querySelectorAll<HTMLElement>(".wd-trow")].find((el) => el.dataset.key === focused);
      row?.focus({ preventScroll: !focusAfterRender });
      if (focusAfterRender) row?.scrollIntoView?.({ block: "nearest" });
    }
    focusAfterRender = false;
  }

  render();

  return {
    element,
    setRecords(next) {
      records = next;
      render();
    },
    selectedKey: () => selected,
  };
}
