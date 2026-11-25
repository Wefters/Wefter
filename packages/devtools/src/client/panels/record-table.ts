import { h } from "../dom.js";
import { icon } from "../icons.js";

export interface TableColumn {
  label: string;
  className?: string;
}

export interface InspectorContent {
  title: Node | string;
  meta?: Node | null;
  body: Node[];
}

export interface RecordTableOptions<T> {
  ariaLabel: string;
  columns: TableColumn[];
  /** CSS grid-template-columns shared by the header and every row. */
  gridTemplate: string;
  keyOf(record: T): string;
  rowClass?(record: T): string;
  cells(record: T, context: { maxDurationMs: number }): Node[];
  durationOf?(record: T): number | undefined;
  inspect(record: T): InspectorContent;
  emptyState(): HTMLElement;
}

export interface RecordTable<T> {
  element: HTMLElement;
  setRecords(records: T[]): void;
  selectedKey(): string | null;
}

const INSPECTOR_WIDTH_KEY = "wefter-devtools:inspector-width";
const MIN_INSPECTOR = 280;

function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY));
    return Number.isFinite(n) && n >= MIN_INSPECTOR ? n : 440;
  } catch {
    return 440;
  }
}

/**
 * A chronological table (oldest first, follows the tail like a real log) with a single selected
 * row whose details open in a resizable inspector on the right — the Network-panel layout.
 *
 * Keyboard: ↑/↓/Home/End move between rows (the inspector follows when open), Enter/Space opens or
 * closes the inspector, Escape closes it. Only one row is ever tabbable (roving tabindex).
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

  function setWidth(px: number): void {
    const max = Math.max(MIN_INSPECTOR, element.clientWidth - 320);
    inspectorWidth = Math.round(Math.min(Math.max(px, MIN_INSPECTOR), max || px));
    element.style.setProperty("--inspector-w", `${inspectorWidth}px`);
    try {
      localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
    } catch {
      /* storage unavailable */
    }
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

  function setSelected(key: string | null, focusRow: boolean): void {
    selected = key;
    if (key) focused = key;
    focusAfterRender = focusRow;
    render();
  }

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

  function renderInspector(): void {
    const record = selected === null ? undefined : records.find((r) => options.keyOf(r) === selected);
    if (!record) {
      inspected = null;
      element.classList.remove("has-inspector");
      inspector.replaceChildren();
      return;
    }
    element.classList.add("has-inspector");
    // Rebuild only when the record object changed, so open tree nodes and scroll survive live updates.
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

  function render(): void {
    const all = keys();
    if (selected !== null && !all.includes(selected)) selected = null;
    if (focused === null || !all.includes(focused)) focused = selected ?? all[all.length - 1] ?? null;

    const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
    // Live updates rebuild the rows; keep keyboard focus on the same row instead of dropping to <body>.
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
