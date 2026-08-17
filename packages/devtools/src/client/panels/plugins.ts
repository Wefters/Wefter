import type { PluginInfo } from "../../shared/events.js";
import { clear, h } from "../dom.js";

function fieldRow(label: string, value: string): HTMLElement {
  return h("div", { class: "wd-plugin-card-row" }, h("span", { class: "wd-col-dim" }, `${label}: `), value);
}

function renderPluginCard(plugin: PluginInfo): HTMLElement {
  const nativeSourceLine = `Android native source: ${plugin.hasAndroidSource ? "yes" : "no"} · iOS native source: ${plugin.hasIosSource ? "yes" : "no"}`;
  const permissionParts: string[] = [];
  if (plugin.hasAndroidSource) permissionParts.push(`Android: ${plugin.androidPermissions.join(", ") || "none"}`);
  if (plugin.hasIosSource) permissionParts.push(`iOS: ${plugin.iosPermissions.join(", ") || "none"}`);

  return h(
    "div",
    { class: "wd-plugin-card" },
    h("div", { class: "wd-plugin-card-name" }, plugin.id),
    fieldRow("Methods", plugin.methods.join(", ") || "none"),
    plugin.hooks.length ? fieldRow("Hooks", plugin.hooks.join(", ")) : null,
    plugin.events.length ? fieldRow("Events", plugin.events.join(", ")) : null,
    permissionParts.length ? fieldRow("Permissions", permissionParts.join(" · ")) : null,
    h("div", { class: "wd-plugin-card-row wd-col-dim" }, nativeSourceLine),
  );
}

export function createPluginsPanel(): HTMLElement {
  const listEl = h("div", { class: "wd-list wd-plugins-list" });
  const refreshBtn = h(
    "button",
    {
      class: "wd-clear-btn",
      onclick: () => {
        void load();
      },
    },
    "Refresh",
  );
  const root = h("div", { class: "wd-panel-content" }, h("div", { class: "wd-toolbar" }, refreshBtn), listEl);

  async function load(): Promise<void> {
    clear(listEl);
    listEl.appendChild(h("div", { class: "wd-empty" }, "Loading…"));
    try {
      const res = await fetch("/__wefter-devtools/api/plugins");
      const plugins = (await res.json()) as PluginInfo[];
      clear(listEl);
      if (plugins.length === 0) {
        listEl.appendChild(h("div", { class: "wd-empty" }, "No plugins configured in wefter.config.json."));
        return;
      }
      for (const plugin of plugins) listEl.appendChild(renderPluginCard(plugin));
    } catch {
      clear(listEl);
      listEl.appendChild(h("div", { class: "wd-empty" }, "Failed to load the plugin catalog."));
    }
  }

  void load();
  return root;
}
