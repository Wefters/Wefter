import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";

const START = "# WEFTER-PROGUARD-RULES-START";
const END = "# WEFTER-PROGUARD-RULES-END";

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
