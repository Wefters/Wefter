import type { Store } from "../store.js";
import type { NetworkRecord } from "../../shared/events.js";
import { h } from "../dom.js";
import { createRecordTable } from "./record-table.js";
import {
  chipGroup,
  clearButton,
  durationCell,
  emptyState,
  formatDuration,
  formatTime,
  inspectorSection,
  jsonPreview,
  keyValueList,
  mutedText,
  pauseControl,
  searchField,
  toolbar,
  toolbarDivider,
  toolbarSpacer,
  tryParseJson,
  valueView,
} from "./shared.js";

type Category = "success" | "error" | "pending";

function categorize(status: NetworkRecord["status"]): Category {
  if (status === "pending") return "pending";
  if (typeof status === "number" && status >= 200 && status < 400) return "success";
  return "error";
}

function splitUrl(url: string): { path: string; host: string } {
  try {
    const parsed = new URL(url, typeof location !== "undefined" ? location.href : "http://localhost/");
    const sameOrigin = typeof location !== "undefined" && parsed.origin === location.origin;
    return { path: `${parsed.pathname}${parsed.search}` || "/", host: sameOrigin ? "" : parsed.host };
  } catch {
    return { path: url, host: "" };
  }
}

function inspectRecord(record: NetworkRecord) {
  const category = categorize(record.status);
  const headers = Object.entries(record.headers ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const body: Node[] = [
    inspectorSection(
      "Overview",
      keyValueList([
        ["URL", h("code", { class: "wd-break" }, record.url)],
        ["Method", h("code", null, record.method)],
        ["Status", h("span", { class: `wd-badge wd-badge-${category}` }, String(record.status))],
        ["Started", formatTime(record.timestamp)],
        ["Duration", record.status === "pending" ? "In flight…" : formatDuration(record.durationMs) || "—"],
        ["Request ID", h("code", null, record.requestId)],
      ]),
    ),
    inspectorSection(
      "Request headers",
      headers.length
        ? keyValueList(headers.map(([k, v]) => [k, h("code", { class: "wd-break" }, v)]))
        : mutedText("No headers recorded"),
      { copy: headers.length ? () => jsonPreview(record.headers) : undefined },
    ),
  ];

  if (record.status === "pending") {
    body.push(inspectorSection("Response", mutedText("Waiting for the response…")));
  } else {
    const parsed = tryParseJson(record.bodyPreview);
    const content =
      record.bodyPreview === undefined || record.bodyPreview === ""
        ? mutedText("Empty body")
        : typeof parsed === "string"
          ? h("pre", { class: "wd-pre" }, parsed)
          : valueView(parsed);
    body.push(
      inspectorSection(
        "Response",
        h(
          "div",
          null,
          content,
          record.bodyTruncated
            ? h("div", { class: "wd-note" }, "Preview truncated — only the start of the body was captured.")
            : null,
        ),
        { copy: record.bodyPreview ? () => record.bodyPreview ?? "" : undefined },
      ),
    );
  }

  const { path } = splitUrl(record.url);
  return {
    title: h("span", { class: "wd-net-title" }, h("span", { class: "wd-col-plugin" }, record.method), " ", path),
    meta: h("span", { class: `wd-badge wd-badge-${category}` }, String(record.status)),
    body,
  };
}

export function createNetworkPanel(store: Store<NetworkRecord[]>, onClear: () => void): HTMLElement {
  let search = "";
  let statusFilter = "";
  let snapshot: NetworkRecord[] | null = null;

  const pause = pauseControl((paused) => {
    snapshot = paused ? store.get() : null;
    render();
  });
  const chips = chipGroup(
    "Filter by result",
    [
      { value: "", label: "All" },
      { value: "error", label: "Failed", tone: "error" },
      { value: "pending", label: "Pending" },
    ],
    (value) => {
      statusFilter = value;
      render();
    },
  );
  const summaryEl = h("span", { class: "wd-summary", "aria-live": "polite" });

  const table = createRecordTable<NetworkRecord>({
    ariaLabel: "Network requests",
    columns: [
      { label: "Status" },
      { label: "Method" },
      { label: "Name" },
      { label: "Duration", className: "wd-th-end" },
      { label: "Time", className: "wd-th-end" },
    ],
    gridTemplate: "72px 72px minmax(0, 1fr) 128px 96px",
    keyOf: (r) => `${r.requestId}@${r.timestamp}`,
    rowClass: (r) => `wd-row-accent-${categorize(r.status)}`,
    durationOf: (r) => r.durationMs,
    cells: (record, { maxDurationMs }) => {
      const category = categorize(record.status);
      const { path, host } = splitUrl(record.url);
      return [
        h("span", { class: "wd-cell" }, h("span", { class: `wd-badge wd-badge-${category}` }, String(record.status))),
        h("span", { class: "wd-cell wd-col-plugin" }, record.method),
        h(
          "span",
          { class: "wd-cell wd-cell-url", title: record.url },
          h("span", { class: "wd-col-method" }, path),
          host ? h("span", { class: "wd-url-host" }, host) : null,
        ),
        durationCell(record.durationMs, record.status === "pending", maxDurationMs),
        h("span", { class: "wd-cell wd-cell-time" }, formatTime(record.timestamp)),
      ];
    },
    inspect: inspectRecord,
    emptyState: () =>
      (snapshot ?? store.get()).length === 0
        ? emptyState("No network activity yet.", "fetch and XMLHttpRequest calls from the app show up here.", "network")
        : emptyState("No requests match the filters.", "Clear the search or pick another result.", "search"),
  });

  const root = h(
    "div",
    { class: "wd-panel-content" },
    toolbar(
      pause.element,
      clearButton(onClear),
      toolbarDivider(),
      searchField("Filter by URL…", (value) => {
        search = value;
        render();
      }),
      chips.element,
      toolbarSpacer(),
      summaryEl,
    ),
    table.element,
  );

  function render(): void {
    const live = store.get();
    const records = snapshot ?? live;
    pause.setPending(snapshot ? Math.max(0, live.length - snapshot.length) : 0);

    const scoped = search ? records.filter((r) => r.url.toLowerCase().includes(search)) : records;
    chips.setCounts({
      error: scoped.filter((r) => categorize(r.status) === "error").length,
      pending: scoped.filter((r) => r.status === "pending").length,
    });
    const filtered = statusFilter ? scoped.filter((r) => categorize(r.status) === statusFilter) : scoped;

    const failed = filtered.filter((r) => categorize(r.status) === "error").length;
    const total = filtered.length === records.length ? `${records.length}` : `${filtered.length} of ${records.length}`;
    summaryEl.textContent = `${total} request${records.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`;

    table.setRecords(filtered);
  }

  store.subscribe(render);
  render();
  return root;
}
