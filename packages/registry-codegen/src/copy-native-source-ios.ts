import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredPlugin } from "./scan-plugins.js";

/**
 * Replaces `destDir` with the `ios/` folders of all plugins, merged into one directory.
 *
 * @returns Names of the plugins that had iOS source.
 */
export function copyIosNativeSource(plugins: DiscoveredPlugin[], destDir: string): string[] {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  const copied: string[] = [];
  for (const plugin of plugins) {
    const sourceDir = join(plugin.packageDir, "ios");
    if (!existsSync(sourceDir)) continue;
    cpSync(sourceDir, destDir, { recursive: true });
    copied.push(plugin.manifest.name);
  }

  return copied;
}
