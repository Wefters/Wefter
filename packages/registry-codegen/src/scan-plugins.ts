import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PluginManifestSchema, type PluginManifest } from "./schema/plugin-schema.js";

/** An installed plugin: its parsed `plugin.json` and the folder it lives in. */
export interface DiscoveredPlugin {
  manifest: PluginManifest;
  packageDir: string;
}

/**
 * Loads the `plugin.json` of each named package. Packages without one are skipped.
 *
 * @param nodeModulesDir Folder that holds the packages.
 * @param packageNames Package names to look at, relative to `nodeModulesDir`.
 * @throws {Error} When a `plugin.json` does not match the schema.
 */
export function scanPlugins(nodeModulesDir: string, packageNames: string[]): DiscoveredPlugin[] {
  const discovered: DiscoveredPlugin[] = [];

  for (const pkgName of packageNames) {
    const packageDir = join(nodeModulesDir, pkgName);
    const manifestPath = join(packageDir, "plugin.json");
    if (!existsSync(manifestPath)) continue;

    const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const result = PluginManifestSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid plugin.json in ${pkgName}: ${result.error.message}`);
    }
    discovered.push({ manifest: result.data, packageDir });
  }

  return discovered;
}
