import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";

const START = "// WEFTER-PLUGIN-DEPS-START";
const END = "// WEFTER-PLUGIN-DEPS-END";

interface ParsedCoordinate {
  group: string;
  artifact: string;
  version: string;
}

interface DeclaredCoordinate extends ParsedCoordinate {
  raw: string;
  pluginName: string;
}

function parseCoordinate(raw: string): ParsedCoordinate | null {
  const parts = raw.split(":");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  const [group, artifact, version] = parts;
  return { group, artifact, version };
}

function majorVersion(version: string): string {
  return version.split(".")[0] ?? version;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (Number.isNaN(na) || Number.isNaN(nb)) return a === b ? 0 : a > b ? 1 : -1;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export interface GradleMergeResult {
  deps: string[];
  conflicts: string[];
}

export function computeGradleMerge(plugins: DiscoveredPlugin[]): GradleMergeResult {
  const declared: { raw: string; pluginName: string }[] = [];
  for (const plugin of plugins) {
    for (const dep of plugin.manifest.nativeDependencies?.android?.gradle ?? []) {
      declared.push({ raw: dep, pluginName: plugin.manifest.name });
    }
  }

  const byKey = new Map<string, DeclaredCoordinate[]>();
  const opaque: string[] = [];

  for (const { raw, pluginName } of declared) {
    const parsed = parseCoordinate(raw);
    if (!parsed) {
      if (!opaque.includes(raw)) opaque.push(raw);
      continue;
    }
    const key = `${parsed.group}:${parsed.artifact}`;
    const list = byKey.get(key) ?? [];
    list.push({ ...parsed, raw, pluginName });
    byKey.set(key, list);
  }

  const conflicts: string[] = [];
  const deps: string[] = [...opaque];

  for (const [key, declarations] of byKey) {
    const distinctVersions = [...new Set(declarations.map((d) => d.version))];
    if (distinctVersions.length > 1 && new Set(distinctVersions.map(majorVersion)).size > 1) {
      const bySource = declarations.map((d) => `${d.pluginName}@${d.version}`).join(", ");
      conflicts.push(
        `${key}: declared at different major versions across plugins (${bySource}) — highest version wins.`,
      );
    }
    const winner = declarations.reduce((best, d) => (compareVersions(d.version, best.version) > 0 ? d : best));
    deps.push(winner.raw);
  }

  return { deps, conflicts };
}

export function mergeGradleDeps(plugins: DiscoveredPlugin[], buildGradlePath: string): string[] {
  const { deps } = computeGradleMerge(plugins);

  const implementationLines = deps.map((d) => `    implementation("${d}")`).join("\n");
  const block = `${START}\n${implementationLines}\n    ${END}`;
  const current = readFileSync(buildGradlePath, "utf-8");

  const updated = current.includes(START)
    ? current.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
    : current.replace("dependencies {", `dependencies {\n${block}`);

  writeFileSync(buildGradlePath, updated);

  return deps;
}
