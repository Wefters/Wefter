import type { Store } from "../store.js";
import type { BridgeRecord, PluginInfo } from "../../shared/events.js";
import { h } from "../dom.js";
import { createRecordTable } from "./record-table.js";
import {
  emptyState,
  iconButton,
  inspectorSection,
  keyValueList,
  mutedText,
  searchField,
  toolbar,
  toolbarSpacer,
} from "./shared.js";

interface CallStats {
  total: number;
  failed: number;
}

type LoadState = "loading" | "ready" | "failed";

function nameList(items: string[], emptyText: string): HTMLElement {
  if (items.length === 0) return mutedText(emptyText);
  return h(
    "ul",
    { class: "wd-name-list" },
    ...items.map((item) => h("li", null, h("code", { class: "wd-tag" }, item))),
  );
}

function platforms(plugin: PluginInfo): HTMLElement {
  return h(
    "span",
    { class: "wd-cell wd-platforms" },
    h("span", { class: `wd-platform${plugin.hasIosSource ? " on" : ""}` }, "iOS"),
    h("span", { class: `wd-platform${plugin.hasAndroidSource ? " on" : ""}` }, "Android"),
  );
}

function callsText(stats: CallStats | undefined): HTMLElement {
  if (!stats) return h("span", { class: "wd-cell wd-cell-num" }, "—");
  return h(
    "span",
    { class: "wd-cell wd-cell-num wd-plugin-calls" },
    String(stats.total),
    stats.failed ? h("span", { class: "wd-plugin-calls-failed" }, ` · ${stats.failed} failed`) : null,
  );
}

export function createPluginsPanel(bridgeStore?: Store<BridgeRecord[]>): HTMLElement {
  let plugins: PluginInfo[] = [];
  let state: LoadState = "loading";
  let search = "";
  let stats = new Map<string, CallStats>();

  const summaryEl = h("span", { class: "wd-summary" });

  function permissionsOf(plugin: PluginInfo): [string, Node][] {
    const rows: [string, Node][] = [];
    if (plugin.hasIosSource) rows.push(["iOS", nameList(plugin.iosPermissions, "None declared")]);
    if (plugin.hasAndroidSource) rows.push(["Android", nameList(plugin.androidPermissions, "None declared")]);
    return rows;
  }

  const table = createRecordTable<PluginInfo>({
    ariaLabel: "Plugins",
    columns: [
      { label: "Plugin" },
      { label: "Platforms" },
      { label: "Methods" },
      { label: "Calls", className: "wd-th-end" },
    ],
    gridTemplate: "minmax(130px, 1fr) 120px minmax(0, 2.4fr) 120px",
    keyOf: (p) => p.id,
    cells: (plugin) => [
      h("span", { class: "wd-cell wd-col-method wd-plugin-name" }, plugin.id),
      platforms(plugin),
      h("span", { class: "wd-cell wd-cell-args" }, plugin.methods.join(", ") || "—"),
      callsText(bridgeStore ? (stats.get(plugin.id) ?? { total: 0, failed: 0 }) : undefined),
    ],
    inspect: (plugin) => {
      const s = stats.get(plugin.id);
      const body: Node[] = [
        inspectorSection(
          "Overview",
          keyValueList([
            ["Plugin", h("code", null, plugin.id)],
            ["iOS source", plugin.hasIosSource ? "Yes" : "No"],
            ["Android source", plugin.hasAndroidSource ? "Yes" : "No"],
            ...(bridgeStore
              ? ([
                  [
                    "Calls",
                    s ? `${s.total} this session${s.failed ? ` · ${s.failed} failed` : ""}` : "None this session",
                  ],
                ] as [string, string][])
              : []),
          ]),
        ),
        inspectorSection("Methods", nameList(plugin.methods, "None")),
      ];
      if (plugin.hooks.length) body.push(inspectorSection("Hooks", nameList(plugin.hooks, "None")));
      if (plugin.events.length) body.push(inspectorSection("Events", nameList(plugin.events, "None")));
      const permissions = permissionsOf(plugin);
      if (permissions.length) body.push(inspectorSection("Permissions", keyValueList(permissions)));
      return { title: plugin.id, meta: null, body };
    },
    emptyState: () => {
      if (state === "loading") return emptyState("Loading…");
      if (state === "failed") {
        return emptyState(
          "Failed to load the plugin catalog.",
          "Check that the dev server is still running, then refresh.",
          "warn",
        );
      }
      if (plugins.length === 0) {
        return emptyState(
          "No plugins configured in wefter.config.json.",
          "Add one with `wefter add <plugin>`.",
          "plugins",
        );
      }
      return emptyState("No plugins match the filter.", undefined, "search");
    },
  });

  const root = h(
    "div",
    { class: "wd-panel-content" },
    toolbar(
      iconButton("reload", "Refresh", () => void load(), { className: "wd-refresh-btn", showLabel: true }),
      searchField("Filter by plugin, method or event…", (value) => {
        search = value;
        render();
      }),
      toolbarSpacer(),
      summaryEl,
    ),
    table.element,
  );

  function computeStats(): void {
    stats = new Map();
    for (const record of bridgeStore?.get() ?? []) {
      const s = stats.get(record.plugin) ?? { total: 0, failed: 0 };
      s.total++;
      if (record.status !== "success" && record.status !== "pending") s.failed++;
      stats.set(record.plugin, s);
    }
  }

  function render(): void {
    computeStats();
    const visible = plugins.filter(
      (p) =>
        !search || [p.id, ...p.methods, ...p.hooks, ...p.events].some((name) => name.toLowerCase().includes(search)),
    );
    summaryEl.textContent =
      state !== "ready" || plugins.length === 0
        ? ""
        : visible.length === plugins.length
          ? `${plugins.length} plugin${plugins.length === 1 ? "" : "s"}`
          : `${visible.length} of ${plugins.length} plugins`;
    table.setRecords(visible);
  }

  async function load(): Promise<void> {
    state = "loading";
    plugins = [];
    render();
    try {
      const res = await fetch("/__wefter-devtools/api/plugins");
      plugins = (await res.json()) as PluginInfo[];
      state = "ready";
    } catch {
      state = "failed";
    }
    render();
  }

  bridgeStore?.subscribe(render);
  void load();
  return root;
}
