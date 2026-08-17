import type { Store } from "../store.js";
import type { BridgeRecord } from "../../shared/events.js";
import { clear, h } from "../dom.js";
import {
  clearButton,
  copyButton,
  expandChevron,
  formatTime,
  jsonPreview,
  statusAccentClass,
  statusBadge,
} from "./shared.js";

const STATUSES = ["pending", "success", "error", "timeout", "cancelled"];

export function createBridgeInspectorPanel(store: Store<BridgeRecord[]>, onClear: () => void): HTMLElement {
  let pluginFilter = "";
  let statusFilter = "";
  const expanded = new Set<string>();

  const pluginSelect = h("select", {
    onchange: (e) => {
      pluginFilter = (e.target as HTMLSelectElement).value;
      render();
    },
  });
  const statusSelect = h(
    "select",
    {
      onchange: (e) => {
        statusFilter = (e.target as HTMLSelectElement).value;
        render();
      },
    },
    h("option", { value: "" }, "All statuses"),
    ...STATUSES.map((s) => h("option", { value: s }, s)),
  );

  const listEl = h("div", { class: "wd-list" });
  const root = h(
    "div",
    { class: "wd-panel-content" },
    h("div", { class: "wd-toolbar" }, pluginSelect, statusSelect, clearButton(onClear)),
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

  function renderRow(record: BridgeRecord): HTMLElement {
    const isOpen = expanded.has(record.callId);
    const nativeStack = record.error?.nativeStack;
    const { nativeStack: _omit, ...errorWithoutStack } = record.error ?? {};
    const detailPayload = {
      args: record.args,
      result: record.result,
      error: record.error ? errorWithoutStack : undefined,
    };

    const wrapper = h("div", { class: `wd-row-group ${statusAccentClass(record.status)}` });
    wrapper.appendChild(
      h(
        "div",
        {
          class: "wd-row",
          onclick: () => {
            if (isOpen) expanded.delete(record.callId);
            else expanded.add(record.callId);
            render();
          },
        },
        h(
          "div",
          { class: "wd-row-main" },
          expandChevron(isOpen),
          statusBadge(record.status),
          h("span", { class: "wd-col-plugin" }, record.plugin),
          h("span", { class: "wd-col-method" }, record.method),
          h(
            "span",
            { class: "wd-col-dim" },
            record.durationMs !== undefined ? `${record.durationMs}ms · ` : "",
            formatTime(record.timestamp),
          ),
        ),
      ),
    );
    if (isOpen) {
      wrapper.appendChild(
        h(
          "div",
          { class: "wd-detail" },
          h(
            "div",
            { class: "wd-detail-header" },
            h("span", { class: "wd-detail-label" }, "Args / Result / Error"),
            copyButton(() => jsonPreview(detailPayload)),
          ),
          jsonPreview(detailPayload),
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
    }
    return wrapper;
  }

  function render(): void {
    const records = store.get();
    renderPluginOptions(records);
    const filtered = records.filter(
      (r) => (!pluginFilter || r.plugin === pluginFilter) && (!statusFilter || r.status === statusFilter),
    );
    clear(listEl);
    if (filtered.length === 0) {
      listEl.appendChild(h("div", { class: "wd-empty" }, "No bridge calls yet."));
      return;
    }
    for (const record of filtered.slice().reverse()) listEl.appendChild(renderRow(record));
  }

  store.subscribe(render);
  render();
  return root;
}
