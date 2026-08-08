import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";

const START = "// WEFTER-PLUGIN-DEPS-START";
const END = "// WEFTER-PLUGIN-DEPS-END";

export function mergeGradleDeps(plugins: DiscoveredPlugin[], buildGradlePath: string): string[] {
  const depList = plugins
    .map((p) => p.manifest.nativeDependencies?.android?.gradle)
    .filter((d): d is string => Boolean(d));

  const deps = depList.map((d) => `    implementation("${d}")`).join("\n");

  const block = `${START}\n${deps}\n    ${END}`;
  const current = readFileSync(buildGradlePath, "utf-8");

  const updated = current.includes(START)
    ? current.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : current.replace("dependencies {", `dependencies {\n${block}`);

  writeFileSync(buildGradlePath, updated);

  return depList;
}
