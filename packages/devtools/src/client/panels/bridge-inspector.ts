import type { Store } from "../store.js";
import type { BridgeRecord } from "../../shared/events.js";
import { clear, h } from "../dom.js";
import {
  clearButton,
  copyButton,
  expandChevron,
  formatTime,
  jsonPreview,
  jsonView,
  statusAccentClass,
  statusBadge,
} from "./shared.js";

const STATUSES = ["pending", "success", "error", "timeout", "cancelled"];

function recordKey(record: BridgeRecord): string {
  return `${record.callId}@${record.timestamp}`;
}

function formatDuration(record: BridgeRecord): string {
  if (record.status === "pending") return "…";
  return record.durationMs !== undefined ? `${record.durationMs} ms` : "";
}

function detailSection(
  label: string,
  value: unknown,
  options: { tone?: "error"; emptyText?: string } = {},
): HTMLElement {
  const hasValue = value !== undefined;
  return h(
    "section",
    { class: `wd-bridge-section${options.tone ? ` wd-bridge-section-${options.tone}` : ""}` },
    h(
      "div",
      { class: "wd-detail-header" },
      h("span", { class: "wd-detail-label" }, label),
      hasValue ? copyButton(() => jsonPreview(value)) : null,
    ),
    hasValue ? jsonView(value) : h("div", { class: "wd-bridge-empty-value" }, options.emptyText ?? "—"),
  );
}

export function createBridgeInspectorPanel(store: Store<BridgeRecord[]>, onClear: () => void): HTMLElement {
  let pluginFilter = "";
  let statusFilter = "";
  let search = "";
  let focusKeyAfterRender: string | null = null;
  const expanded = new Set<string>();

  const searchInput = h("input", {
    type: "search",
    class: "wd-search",
    placeholder: "Filter calls (plugin.method)…",
    "aria-label": "Filter bridge calls",
    oninput: (e) => {
      search = (e.target as HTMLInputElement).value.trim().toLowerCase();
      render();
    },
  });
  const pluginSelect = h("select", {
    "aria-label": "Filter by plugin",
    onchange: (e) => {
      pluginFilter = (e.target as HTMLSelectElement).value;
      render();
    },
  });
  const statusSelect = h(
    "select",
    {
      "aria-label": "Filter by status",
      onchange: (e) => {
        statusFilter = (e.target as HTMLSelectElement).value;
        render();
      },
    },
    h("option", { value: "" }, "All statuses"),
    ...STATUSES.map((s) => h("option", { value: s }, s)),
  );
  const summaryEl = h("span", { class: "wd-summary", "aria-live": "polite" });

  const listEl = h("div", { class: "wd-list" });
  const root = h(
    "div",
    { class: "wd-panel-content" },
    h("div", { class: "wd-toolbar" }, searchInput, pluginSelect, statusSelect, summaryEl, clearButton(onClear)),
    listEl,
  );

  function renderPluginOptions(records: BridgeRecord[]): void {
    const plugins = [...new Set(records.map((r) => r.plugin))].sort();
    const current = pluginSelect.value;
    clear(pluginSelect);
    pluginSelect.appendChild(h("option", { value: "" }, "All plugins"));
    for (const plugin of plugins) pluginSelect.appendChild(h("option", { value: plugin }, plugin));
    pluginSelect.value = plugins.includes(current) ? current : "";
  }

  function toggle(key: string, refocus: boolean): void {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    focusKeyAfterRender = refocus ? key : null;
    render();
  }

  function renderRow(record: BridgeRecord): HTMLElement {
    const key = recordKey(record);
    const isOpen = expanded.has(key);

    const row = h(
      "div",
      {
        class: "wd-row wd-bridge-row",
        role: "button",
        tabindex: "0",
        "aria-expanded": String(isOpen),
        "data-key": key,
        onclick: () => toggle(key, false),
        onkeydown: (e) => {
          const { key: pressed } = e as KeyboardEvent;
          if (pressed === "Enter" || pressed === " ") {
            e.preventDefault();
            toggle(key, true);
          }
        },
      },
      expandChevron(isOpen),
      statusBadge(record.status),
      h(
        "span",
        { class: "wd-bridge-call" },
        h("span", { class: "wd-col-plugin" }, record.plugin),
        h("span", { class: "wd-bridge-sep" }, "."),
        h("span", { class: "wd-col-method" }, record.method),
      ),
      h("span", { class: "wd-bridge-duration" }, formatDuration(record)),
      h("span", { class: "wd-bridge-time" }, formatTime(record.timestamp)),
    );

    const wrapper = h(
      "div",
      { class: `wd-row-group ${statusAccentClass(record.status)}${isOpen ? " open" : ""}` },
      row,
    );
    if (!isOpen) return wrapper;

    const nativeStack = record.error?.nativeStack;
    const { nativeStack: _omit, ...errorWithoutStack } = record.error ?? {};

    let outcome: HTMLElement;
    if (record.status === "pending") {
      outcome = detailSection("Result", undefined, { emptyText: "Waiting for the native side to respond…" });
    } else if (record.error) {
      outcome = detailSection("Error", errorWithoutStack, { tone: "error" });
    } else {
      outcome = detailSection("Result", record.result, { emptyText: "No value returned" });
    }

    wrapper.appendChild(
      h(
        "div",
        { class: "wd-detail wd-bridge-detail" },
        h(
          "div",
          { class: "wd-bridge-sections" },
          detailSection("Arguments", record.args, { emptyText: "None" }),
          outcome,
        ),
        h("div", { class: "wd-bridge-meta" }, `call id ${record.callId}`),
      ),
    );
    if (nativeStack) {
      wrapper.appendChild(
        h(
          "div",
          { class: "wd-detail wd-native-stack" },
          h(
            "div",
            { class: "wd-detail-header" },
            h("span", { class: "wd-detail-label" }, "Native stack trace"),
            copyButton(() => nativeStack),
          ),
          nativeStack,
        ),
      );
    }
    return wrapper;
  }

  function render(): void {
    const records = store.get();
    renderPluginOptions(records);
    const filtered = records.filter(
      (r) =>
        (!pluginFilter || r.plugin === pluginFilter) &&
        (!statusFilter || r.status === statusFilter) &&
        (!search || `${r.plugin}.${r.method}`.toLowerCase().includes(search)),
    );

    const failed = filtered.filter((r) => r.status !== "success" && r.status !== "pending").length;
    const pendingCount = filtered.filter((r) => r.status === "pending").length;
    const total = filtered.length === records.length ? `${records.length}` : `${filtered.length} of ${records.length}`;
    summaryEl.textContent =
      `${total} call${records.length === 1 ? "" : "s"}` +
      (failed ? ` · ${failed} failed` : "") +
      (pendingCount ? ` · ${pendingCount} pending` : "");

    clear(listEl);
    if (filtered.length === 0) {
      listEl.appendChild(
        h("div", { class: "wd-empty" }, records.length === 0 ? "No bridge calls yet." : "No calls match the filters."),
      );
      return;
    }

    listEl.appendChild(
      h(
        "div",
        { class: "wd-bridge-head", "aria-hidden": "true" },
        h("span", null),
        h("span", null, "Status"),
        h("span", null, "Call"),
        h("span", { class: "wd-bridge-duration" }, "Duration"),
        h("span", { class: "wd-bridge-time" }, "Time"),
      ),
    );
    for (const record of filtered.slice().reverse()) listEl.appendChild(renderRow(record));

    if (focusKeyAfterRender) {
      const target = [...listEl.querySelectorAll<HTMLElement>(".wd-bridge-row")].find(
        (el) => el.dataset.key === focusKeyAfterRender,
      );
      target?.focus();
      focusKeyAfterRender = null;
    }
  }

  store.subscribe(render);
  render();
  return root;
}
