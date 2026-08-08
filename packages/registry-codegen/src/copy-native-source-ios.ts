import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredPlugin } from "./scan-plugins.js";

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
