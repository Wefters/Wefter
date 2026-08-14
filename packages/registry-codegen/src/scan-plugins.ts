import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PluginManifestSchema, type PluginManifest } from "./schema/plugin-schema.js";

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  packageDir: string;
}

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
