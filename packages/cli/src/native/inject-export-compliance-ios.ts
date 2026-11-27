/**
 * Export compliance in the iOS `Info.plist`: `ITSAppUsesNonExemptEncryption` tells App Store Connect
 * whether the app uses encryption beyond what iOS provides (HTTPS), so it stops asking on every upload.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const KEY = "ITSAppUsesNonExemptEncryption";

/**
 * Sets `ITSAppUsesNonExemptEncryption` to `value`, or removes it when `value` is `undefined` (App Store
 * Connect then asks on each upload).
 */
export function injectExportComplianceIos(infoPlistPath: string, value: boolean | undefined): void {
  if (!existsSync(infoPlistPath)) return;
  const current = readFileSync(infoPlistPath, "utf-8");
  const existing = new RegExp(`\\n?[ \\t]*<key>${KEY}</key>\\s*<(?:true|false)\\s*/>`);
  let updated = current.replace(existing, "");
  if (value !== undefined) {
    const entry = `\t<key>${KEY}</key>\n\t<${value}/>`;
    const closing = updated.lastIndexOf("</dict>");
    if (closing === -1) throw new Error(`No <dict> found in ${infoPlistPath}`);
    updated = `${updated.slice(0, closing).replace(/\s*$/, "\n")}${entry}\n${updated.slice(closing)}`;
  }
  if (updated !== current) writeFileSync(infoPlistPath, updated);
}
