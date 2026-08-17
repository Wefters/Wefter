import type { Store } from "../store.js";
import type { NetworkRecord } from "../../shared/events.js";
import { clear, h } from "../dom.js";
import { clearButton, copyButton, expandChevron, formatTime, jsonPreview, tryParseJson } from "./shared.js";

export function createNetworkPanel(store: Store<NetworkRecord[]>, onClear: () => void): HTMLElement {
  let search = "";
  const expanded = new Set<string>();

  const searchInput = h("input", {
    type: "text",
    placeholder: "Filter by URL…",
    oninput: (e) => {
      search = (e.target as HTMLInputElement).value.toLowerCase();
      render();
    },
  });

  const listEl = h("div", { class: "wd-list" });
  const root = h(
    "div",
    { class: "wd-panel-content" },
    h("div", { class: "wd-toolbar" }, searchInput, clearButton(onClear)),
    listEl,
  );

  function categorize(status: NetworkRecord["status"]): "success" | "error" | "pending" {
    if (status === "pending") return "pending";
    if (typeof status === "number" && status >= 200 && status < 400) return "success";
    return "error";
  }

  function renderRow(record: NetworkRecord): HTMLElement {
    const isOpen = expanded.has(record.requestId);
    const category = categorize(record.status);
    const detailPayload = {
      headers: record.headers,
      bodyPreview: tryParseJson(record.bodyPreview),
      bodyTruncated: record.bodyTruncated,
    };

    const wrapper = h("div", { class: `wd-row-group wd-row-accent-${category}` });
    wrapper.appendChild(
      h(
        "div",
        {
          class: "wd-row",
          onclick: () => {
            if (isOpen) expanded.delete(record.requestId);
            else expanded.add(record.requestId);
            render();
          },
        },
        h(
          "div",
          { class: "wd-row-main" },
          expandChevron(isOpen),
          h("span", { class: `wd-badge wd-badge-${category}` }, String(record.status)),
          h("span", { class: "wd-col-plugin" }, record.method),
          h("span", { class: "wd-col-method" }, record.url),
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
            h("span", { class: "wd-detail-label" }, "Headers / Body preview"),
            copyButton(() => jsonPreview(detailPayload)),
          ),
          jsonPreview(detailPayload),
        ),
      );
    }
    return wrapper;
  }

  function render(): void {
    const records = store.get();
    const filtered = search ? records.filter((r) => r.url.toLowerCase().includes(search)) : records;
    clear(listEl);
    if (filtered.length === 0) {
      listEl.appendChild(h("div", { class: "wd-empty" }, "No network activity yet."));
      return;
    }
    for (const record of filtered.slice().reverse()) listEl.appendChild(renderRow(record));
  }

  store.subscribe(render);
  render();
  return root;
}
