import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";

const START = "<!-- WEFTER-PERMISSIONS-START -->";
const END = "<!-- WEFTER-PERMISSIONS-END -->";

/** Escapes text for use inside a plist element. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Writes the iOS permission usage descriptions of all plugins, and the `appDescriptions` of the app
 * itself, into `Info.plist`, between the `WEFTER-PERMISSIONS` markers. When two plugins set the same key,
 * the later one wins; the app's own description wins over every plugin's.
 *
 * @returns The keys and descriptions that were written.
 */
export function mergeInfoPlist(
  plugins: DiscoveredPlugin[],
  infoPlistPath: string,
  appDescriptions: Record<string, string> = {},
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const plugin of plugins) {
    Object.assign(merged, plugin.manifest.permissions?.ios ?? {});
  }
  Object.assign(merged, appDescriptions);

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
