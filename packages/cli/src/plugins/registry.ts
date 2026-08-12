import { existsSync } from "node:fs";
import { join } from "node:path";
import { scanPlugins, type DiscoveredPlugin } from "@wefterjs/registry-codegen";

export function resolveRegisteredPlugins(
  pluginsDir: string,
  packageNames: string[],
): DiscoveredPlugin[] {
  return scanPlugins(pluginsDir, packageNames);
}

export function unresolvedRegisteredPlugins(
  pluginsDir: string,
  packageNames: string[],
): string[] {
  return packageNames.filter(
    (name) => !existsSync(join(pluginsDir, name, "plugin.json")),
  );
}
