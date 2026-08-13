import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";
import type { IntentFilter, IntentFilterData, ManifestEntry, PluginManifest } from "./schema/plugin-schema.js";

const START = "<!-- WEFTER-COMPONENTS-START -->";
const END = "<!-- WEFTER-COMPONENTS-END -->";

const TAG_BY_TYPE: Record<ManifestEntry["type"], string> = {
  activity: "activity",
};

const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g;

export function resolvePlaceholders(value: string, pluginConfig: Record<string, string>, context: string): string {
  return value.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    const resolved = pluginConfig[key];
    if (resolved === undefined) {
      throw new Error(
        `${context} references "\${${key}}", but wefter.config.json's "pluginConfig" has no "${key}" key. ` +
          `Add it (e.g. { "pluginConfig": { "${key}": "your-value" } }) and re-run \`wefter sync\`.`,
      );
    }
    return resolved;
  });
}

export function extractRequiredPluginConfigKeys(manifest: PluginManifest): string[] {
  const keys = new Set<string>();
  for (const entry of manifest.android?.manifestEntries ?? []) {
    for (const filter of entry.intentFilters) {
      if (!filter.data) continue;
      for (const value of Object.values(filter.data)) {
        if (typeof value !== "string") continue;
        for (const match of value.matchAll(PLACEHOLDER_PATTERN)) keys.add(match[1]);
      }
    }
  }
  return [...keys];
}

function resolveIntentFilterData(
  data: IntentFilterData | undefined,
  pluginConfig: Record<string, string>,
  context: string,
): IntentFilterData | undefined {
  if (!data) return undefined;
  const resolved: IntentFilterData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    (resolved as Record<string, string>)[key] = resolvePlaceholders(value, pluginConfig, context);
  }
  return resolved;
}

function renderIntentFilter(filter: IntentFilter): string {
  const lines = [`            <intent-filter>`, `                <action android:name="${filter.action}" />`];
  for (const category of filter.categories) {
    lines.push(`                <category android:name="${category}" />`);
  }
  if (filter.data && Object.keys(filter.data).length > 0) {
    const attrs = Object.entries(filter.data)
      .map(([key, value]) => `android:${key}="${value}"`)
      .join(" ");
    lines.push(`                <data ${attrs} />`);
  }
  lines.push(`            </intent-filter>`);
  return lines.join("\n");
}

function renderManifestEntry(entry: ManifestEntry): string {
  const tag = TAG_BY_TYPE[entry.type];
  const filtersBlock =
    entry.intentFilters.length > 0 ? `\n${entry.intentFilters.map(renderIntentFilter).join("\n")}\n        ` : "";
  return [
    `        <${tag}`,
    `            android:name="${entry.name}"`,
    `            android:exported="${entry.exported}">${filtersBlock}</${tag}>`,
  ].join("\n");
}

export interface MergedManifestEntry {
  pluginName: string;
  type: ManifestEntry["type"];
  name: string;
  exported: boolean;
}

export function mergeManifestEntries(
  plugins: DiscoveredPlugin[],
  manifestPath: string,
  pluginConfig: Record<string, string> = {},
): MergedManifestEntry[] {
  const added: MergedManifestEntry[] = [];
  const blocks: string[] = [];

  for (const plugin of plugins) {
    for (const entry of plugin.manifest.android?.manifestEntries ?? []) {
      const context = `Plugin "${plugin.manifest.name}"'s manifestEntries entry "${entry.name}"`;
      const resolvedEntry: ManifestEntry = {
        ...entry,
        intentFilters: entry.intentFilters.map((filter) => ({
          ...filter,
          data: resolveIntentFilterData(filter.data, pluginConfig, context),
        })),
      };

      blocks.push(renderManifestEntry(resolvedEntry));
      added.push({ pluginName: plugin.manifest.name, type: entry.type, name: entry.name, exported: entry.exported });
    }
  }

  const block = `${START}\n${blocks.join("\n")}\n    ${END}`;
  const current = readFileSync(manifestPath, "utf-8");

  const updated = current.includes(START)
    ? current.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : current.replace(/(<\/application>)/, `\n${block}\n    $1`);

  writeFileSync(manifestPath, updated);

  return added;
}
