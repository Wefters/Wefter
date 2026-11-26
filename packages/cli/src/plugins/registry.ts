import { existsSync } from "node:fs";
import { join } from "node:path";
import { scanPlugins, type DiscoveredPlugin } from "@wefterjs/registry-codegen";

/** Loads the plugins listed in `wefter.config.json` from the plugins folder. */
export function resolveRegisteredPlugins(pluginsDir: string, packageNames: string[]): DiscoveredPlugin[] {
  return scanPlugins(pluginsDir, packageNames);
}

/** Listed plugins that are not installed (no `plugin.json` found). */
export function unresolvedRegisteredPlugins(pluginsDir: string, packageNames: string[]): string[] {
  return packageNames.filter((name) => !existsSync(join(pluginsDir, name, "plugin.json")));
}
