import type { Store } from "../store.js";
import type { BridgeRecord } from "../../shared/events.js";
import { clear, h } from "../dom.js";
import { createRecordTable } from "./record-table.js";
import {
  chipGroup,
  clearButton,
  compactPreview,
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
  statusAccentClass,
  statusBadge,
  toolbar,
  toolbarDivider,
  toolbarSpacer,
  valueView,
} from "./shared.js";

const FAILED = new Set(["error", "timeout", "cancelled"]);

/**
 * Identity of one row. callId alone is not enough: records buffered before a reload (or sent by an
 * older @wefterjs/core whose ids restart at "0") can share a callId.
 */
function recordKey(record: BridgeRecord): string {
  return `${record.callId}@${record.timestamp}`;
}

function hasArgs(args: unknown): boolean {
  if (args === undefined || args === null) return false;
  if (typeof args === "object") return Object.keys(args).length > 0;
  return true;
}

function callName(record: BridgeRecord, className = "wd-bridge-call"): HTMLElement {
  return h(
    "span",
    { class: className },
    h("span", { class: "wd-col-plugin" }, record.plugin),
    h("span", { class: "wd-bridge-sep" }, "."),
    h("span", { class: "wd-col-method" }, record.method),
  );
}

function inspectRecord(record: BridgeRecord) {
  const body: Node[] = [];
  const { nativeStack, ...errorWithoutStack } = record.error ?? {};

  if (record.error) {
    body.push(
      h(
        "div",
        { class: "wd-callout wd-callout-error", role: "status" },
        h("div", { class: "wd-callout-code" }, record.error.code),
        h("div", { class: "wd-callout-message" }, record.error.message),
      ),
    );
  }

  body.push(
    inspectorSection(
      "Overview",
      keyValueList([
        ["Plugin", h("code", null, record.plugin)],
        ["Method", h("code", null, record.method)],
        ["Status", statusBadge(record.status)],
        ["Started", formatTime(record.timestamp)],
        ["Duration", record.status === "pending" ? "Waiting for native…" : formatDuration(record.durationMs) || "—"],
        ["Call ID", h("code", null, record.callId)],
      ]),
    ),
    inspectorSection("Arguments", hasArgs(record.args) ? valueView(record.args) : mutedText("No arguments"), {
      copy: hasArgs(record.args) ? () => jsonPreview(record.args) : undefined,
      className: "wd-bridge-section",
    }),
  );

  if (record.status === "pending") {
    body.push(
      inspectorSection("Result", mutedText("Waiting for the native side to respond…"), {
        className: "wd-bridge-section",
      }),
    );
  } else if (record.error) {
    body.push(
      inspectorSection("Error", valueView(errorWithoutStack), {
        tone: "error",
        copy: () => jsonPreview(errorWithoutStack),
        className: "wd-bridge-section wd-bridge-section-error",
      }),
    );
  } else {
    body.push(
      inspectorSection(
        "Result",
        record.result === undefined ? mutedText("No value returned") : valueView(record.result),
        {
          copy: record.result === undefined ? undefined : () => jsonPreview(record.result),
          className: "wd-bridge-section",
        },
      ),
    );
  }

  if (nativeStack) {
    body.push(
      inspectorSection("Native stack trace", h("pre", { class: "wd-pre wd-stack" }, nativeStack), {
        copy: () => nativeStack,
        className: "wd-native-stack",
      }),
    );
  }

  return { title: callName(record), meta: statusBadge(record.status), body };
}

export function createBridgeInspectorPanel(store: Store<BridgeRecord[]>, onClear: () => void): HTMLElement {
  let pluginFilter = "";
  let statusFilter = "";
  let search = "";
  let snapshot: BridgeRecord[] | null = null;

  const pause = pauseControl((paused) => {
    snapshot = paused ? store.get() : null;
    render();
  });
  const pluginSelect = h("select", {
    class: "wd-select",
    "aria-label": "Filter by plugin",
    onchange: (e) => {
      pluginFilter = (e.target as HTMLSelectElement).value;
      render();
    },
  });
  const statusChips = chipGroup(
    "Filter by status",
    [
      { value: "", label: "All" },
      { value: "success", label: "Success" },
      { value: "failed", label: "Failed", tone: "error" },
      { value: "pending", label: "Pending" },
    ],
    (value) => {
      statusFilter = value;
      render();
    },
  );
  const summaryEl = h("span", { class: "wd-summary", "aria-live": "polite" });

  const table = createRecordTable<BridgeRecord>({
    ariaLabel: "Bridge calls",
    columns: [
      { label: "Status" },
      { label: "Call" },
      { label: "Arguments" },
      { label: "Duration", className: "wd-th-end" },
      { label: "Time", className: "wd-th-end" },
    ],
    gridTemplate: "84px minmax(150px, 1.1fr) minmax(0, 1.6fr) 128px 96px",
    keyOf: recordKey,
    // A cancelled call (the user backed out) is not shown as a failure.
    rowClass: (r) => (r.status === "cancelled" ? "" : statusAccentClass(r.status)),
    durationOf: (r) => r.durationMs,
    cells: (record, { maxDurationMs }) => [
      h("span", { class: "wd-cell" }, statusBadge(record.status)),
      callName(record, "wd-cell wd-bridge-call"),
      h("span", { class: "wd-cell wd-cell-args" }, hasArgs(record.args) ? compactPreview(record.args) : "—"),
      durationCell(record.durationMs, record.status === "pending", maxDurationMs),
      h("span", { class: "wd-cell wd-cell-time" }, formatTime(record.timestamp)),
    ],
    inspect: inspectRecord,
    emptyState: () =>
      (snapshot ?? store.get()).length === 0
        ? emptyState("No bridge calls yet.", "Calls from your app to native plugins show up here live.", "bridge")
        : emptyState("No calls match the filters.", "Clear the search or pick another plugin or status.", "search"),
  });

  const root = h(
    "div",
    { class: "wd-panel-content" },
    toolbar(
      pause.element,
      clearButton(onClear),
      toolbarDivider(),
      searchField("Filter by plugin or method…", (value) => {
        search = value;
        render();
      }),
      pluginSelect,
      statusChips.element,
      toolbarSpacer(),
      summaryEl,
    ),
    table.element,
  );

  function renderPluginOptions(records: BridgeRecord[]): void {
    const plugins = [...new Set(records.map((r) => r.plugin))].sort();
    clear(pluginSelect);
    pluginSelect.appendChild(h("option", { value: "" }, "All plugins"));
    for (const plugin of plugins) pluginSelect.appendChild(h("option", { value: plugin }, plugin));
    if (!plugins.includes(pluginFilter)) pluginFilter = "";
    pluginSelect.value = pluginFilter;
  }

  function matchesStatus(record: BridgeRecord): boolean {
    if (!statusFilter) return true;
    if (statusFilter === "failed") return FAILED.has(record.status);
    return record.status === statusFilter;
  }

  function render(): void {
    const live = store.get();
    const records = snapshot ?? live;
    pause.setPending(snapshot ? Math.max(0, live.length - snapshot.length) : 0);
    renderPluginOptions(records);

    const scoped = records.filter(
      (r) =>
        (!pluginFilter || r.plugin === pluginFilter) &&
        (!search || `${r.plugin}.${r.method}`.toLowerCase().includes(search)),
    );
    statusChips.setCounts({
      success: scoped.filter((r) => r.status === "success").length,
      failed: scoped.filter((r) => FAILED.has(r.status)).length,
      pending: scoped.filter((r) => r.status === "pending").length,
    });
    const filtered = scoped.filter(matchesStatus);

    const failed = filtered.filter((r) => FAILED.has(r.status)).length;
    const pendingCount = filtered.filter((r) => r.status === "pending").length;
    const total = filtered.length === records.length ? `${records.length}` : `${filtered.length} of ${records.length}`;
    summaryEl.textContent =
      `${total} call${records.length === 1 ? "" : "s"}` +
      (failed ? ` · ${failed} failed` : "") +
      (pendingCount ? ` · ${pendingCount} pending` : "");

    table.setRecords(filtered);
  }

  store.subscribe(render);
  render();
  return root;
}
