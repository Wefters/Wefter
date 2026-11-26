import { readFileSync, writeFileSync } from "node:fs";
import type { DiscoveredPlugin } from "./scan-plugins.js";

const START = "// WEFTER-PLUGIN-DEPS-START";
const END = "// WEFTER-PLUGIN-DEPS-END";

/** The parts of a `group:artifact:version` Gradle coordinate. */
interface ParsedCoordinate {
  group: string;
  artifact: string;
  version: string;
}

/** A parsed coordinate and the plugin that declared it. */
interface DeclaredCoordinate extends ParsedCoordinate {
  raw: string;
  pluginName: string;
}

/** Splits a `group:artifact:version` coordinate, or returns `null` when it has another shape. */
function parseCoordinate(raw: string): ParsedCoordinate | null {
  const parts = raw.split(":");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  const [group, artifact, version] = parts;
  return { group, artifact, version };
}

/** The first dot-separated part of a version. */
function majorVersion(version: string): string {
  return version.split(".")[0] ?? version;
}

/** Compares dotted numeric versions. Falls back to string order when a part is not a number. */
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

/** The dependencies to write and the version conflicts found among them. */
export interface GradleMergeResult {
  deps: string[];
  conflicts: string[];
}

/**
 * Combines the Gradle dependencies of all plugins. When several plugins use the same artifact, the
 * highest version wins, and different major versions are reported as conflicts. Coordinates that are not
 * `group:artifact:version` are kept as they are.
 */
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

/**
 * Writes the merged plugin dependencies into `build.gradle.kts`, between the `WEFTER-PLUGIN-DEPS`
 * markers. The markers are created at the top of `dependencies { }` the first time.
 *
 * @returns The dependencies that were written.
 */
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
