import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";

const START = "<!-- WEFTER-PERMISSIONS-START -->";
const END = "<!-- WEFTER-PERMISSIONS-END -->";

export function mergePermissions(plugins: DiscoveredPlugin[], manifestPath: string): string[] {
  const permissions = new Set<string>();
  for (const plugin of plugins) {
    for (const perm of plugin.manifest.permissions?.android ?? []) {
      permissions.add(perm);
    }
  }

  const tags = [...permissions].map((p) => `    <uses-permission android:name="${p}" />`).join("\n");

  const block = `${START}\n${tags}\n    ${END}`;
  const current = readFileSync(manifestPath, "utf-8");

  const updated = current.includes(START)
    ? current.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : current.replace(/(<manifest[^>]*>)/, `$1\n\n${block}`);

  writeFileSync(manifestPath, updated);

  return [...permissions];
}
