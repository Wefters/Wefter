import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";

const START = "<!-- WEFTER-PERMISSIONS-START -->";
const END = "<!-- WEFTER-PERMISSIONS-END -->";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function mergeInfoPlist(plugins: DiscoveredPlugin[], infoPlistPath: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const plugin of plugins) {
    Object.assign(merged, plugin.manifest.permissions?.ios ?? {});
  }

  const entries = Object.entries(merged)
    .map(([key, description]) => `\t<key>${escapeXml(key)}</key>\n\t<string>${escapeXml(description)}</string>`)
    .join("\n");

  const block = `${START}\n${entries}\n\t${END}`;
  const current = readFileSync(infoPlistPath, "utf-8");

  const updated = current.includes(START)
    ? current.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : current.replace(/(<dict>)/, `$1\n\n\t${block}`);

  writeFileSync(infoPlistPath, updated);

  return merged;
}
