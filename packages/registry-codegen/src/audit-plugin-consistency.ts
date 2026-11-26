import type { DiscoveredPlugin } from "./scan-plugins.js";
import type { ExtractedHook, ExtractedMethod } from "./extract-wefter-plugin.js";

/**
 * Compares the names a manifest declares with the names found in source. An empty declaration is not
 * checked.
 */
function checkField(pluginName: string, fieldLabel: string, declared: string[], extracted: string[]): string[] {
  if (declared.length === 0) return [];

  const missing = declared.filter((d) => !extracted.includes(d));
  const undeclared = extracted.filter((e) => !declared.includes(e));
  if (missing.length === 0 && undeclared.length === 0) return [];

  return [
    `Plugin "${pluginName}": plugin.json's "${fieldLabel}" declares [${declared}] but source has [${extracted}]. ` +
      `Missing: [${missing}]. Undeclared: [${undeclared}].`,
  ];
}

/**
 * Makes sure the `methods` and `hooks` listed in `plugin.json` match the annotated methods and hooks in
 * the plugin's native source.
 *
 * @throws {Error} Listing every missing and undeclared name.
 */
export function auditPluginConsistency(
  plugin: DiscoveredPlugin,
  methods: ExtractedMethod[],
  hooks: ExtractedHook[],
): void {
  const errors = [
    ...checkField(
      plugin.manifest.name,
      "methods",
      plugin.manifest.methods ?? [],
      methods.map((m) => m.name),
    ),
    ...checkField(
      plugin.manifest.name,
      "hooks",
      plugin.manifest.hooks ?? [],
      hooks.map((h) => h.hookName),
    ),
  ];

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
