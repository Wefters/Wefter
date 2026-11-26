import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";

const START = "# WEFTER-PROGUARD-RULES-START";
const END = "# WEFTER-PROGUARD-RULES-END";

/**
 * Writes the ProGuard/R8 rules of all plugins into `proguard-rules.pro`, between the
 * `WEFTER-PROGUARD-RULES` markers, so release builds keep the classes plugins need.
 *
 * @returns The rule blocks that were written.
 */
export function mergeProguardRules(plugins: DiscoveredPlugin[], proguardRulesPath: string): string[] {
  const ruleList = plugins
    .map((p) => p.manifest.nativeDependencies?.android?.proguardRules)
    .filter((r): r is string => Boolean(r));

  const rules = ruleList.join("\n");
  const block = `${START}\n${rules}\n${END}`;
  const current = readFileSync(proguardRulesPath, "utf-8");

  const updated = current.includes(START)
    ? current.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : `${current}\n${block}\n`;

  writeFileSync(proguardRulesPath, updated);

  return ruleList;
}
