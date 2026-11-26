import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";
import type { IntentFilter, IntentFilterData, ManifestEntry, PluginManifest } from "./schema/plugin-schema.js";

const START = "<!-- WEFTER-COMPONENTS-START -->";
const END = "<!-- WEFTER-COMPONENTS-END -->";

/** The manifest tag written for each entry type. */
const TAG_BY_TYPE: Record<ManifestEntry["type"], string> = {
  activity: "activity",
};

/** Matches `${key}` placeholders, which are filled from `pluginConfig` in `wefter.config.json`. */
const PLACEHOLDER_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Placeholders left in the manifest for Gradle's manifest merger, which fills them per build flavor.
 * `${applicationId}` becomes each environment's app id, so a scheme such as `${applicationId}.auth` differs
 * between development and production builds.
 */
const GRADLE_PLACEHOLDERS = new Set(["applicationId"]);

/**
 * Replaces every `${key}` in `value` with the matching `pluginConfig` value. Gradle's own placeholders
 * (such as `${applicationId}`) are kept as they are.
 *
 * @param context Describes where the value came from, for the error message.
 * @throws {Error} When a referenced key is missing, explaining how to add it.
 */
export function resolvePlaceholders(value: string, pluginConfig: Record<string, string>, context: string): string {
  return value.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    if (GRADLE_PLACEHOLDERS.has(key)) return match;
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

/** Lists the `pluginConfig` keys a plugin's intent filters reference, leaving out Gradle's own placeholders. */
export function extractRequiredPluginConfigKeys(manifest: PluginManifest): string[] {
  const keys = new Set<string>();
  for (const entry of manifest.android?.manifestEntries ?? []) {
    for (const filter of entry.intentFilters) {
      if (!filter.data) continue;
      for (const value of Object.values(filter.data)) {
        if (typeof value !== "string") continue;
        for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
          if (!GRADLE_PLACEHOLDERS.has(match[1])) keys.add(match[1]);
        }
      }
    }
  }
  return [...keys];
}

/** Resolves placeholders in every attribute of an intent filter's `<data>` element. */
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

/** Renders an `<intent-filter>` element. */
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

/** Renders one component element (for example an `<activity>`) with its launch mode and intent filters. */
function renderManifestEntry(entry: ManifestEntry): string {
  const tag = TAG_BY_TYPE[entry.type];
  const filtersBlock =
    entry.intentFilters.length > 0 ? `\n${entry.intentFilters.map(renderIntentFilter).join("\n")}\n        ` : "";
  return [
    `        <${tag}`,
    `            android:name="${entry.name}"`,
    ...(entry.launchMode ? [`            android:launchMode="${entry.launchMode}"`] : []),
    `            android:exported="${entry.exported}">${filtersBlock}</${tag}>`,
  ].join("\n");
}

/** A component a plugin added to `AndroidManifest.xml`. */
export interface MergedManifestEntry {
  pluginName: string;
  type: ManifestEntry["type"];
  name: string;
  exported: boolean;
}

/**
 * Writes the components (activities and their intent filters) that plugins declare into
 * `AndroidManifest.xml`, between the `WEFTER-COMPONENTS` markers. The markers are created before
 * `</application>` the first time.
 *
 * @returns The entries that were written.
 */
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
