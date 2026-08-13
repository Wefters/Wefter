import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeGradleMerge, extractRequiredPluginConfigKeys, validatePluginDirectory } from "@wefterjs/registry-codegen";
import { loadWefterConfig, pluginsDirPath } from "../config/project-paths.js";
import { runNpmInstall } from "../plugins/npm-install.js";
import { resolveRegisteredPlugins } from "../plugins/registry.js";

const PACKAGE_SPEC_PATTERN = /^(@[a-z0-9-]+\/[a-z0-9-]+|[a-z0-9-]+)(@[\w.\-^~]+)?$/;

export interface AddResult {
  added: boolean;
  alreadyDeclared: boolean;
  issues: string[];
  exportedComponents: string[];
  requiredConfigKeys: string[];
  gradleConflicts: string[];
}

function parsePackageSpec(spec: string): { name: string; versionSpec?: string } {
  const match = PACKAGE_SPEC_PATTERN.exec(spec);
  if (!match) {
    throw new Error(`"${spec}" doesn't look like a valid npm package name.`);
  }
  return { name: match[1], versionSpec: match[2] };
}

function readRawConfig(projectDir: string): Record<string, unknown> {
  const path = join(projectDir, "wefter.config.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

export async function add(
  projectDir: string,
  packageSpec: string,
  install: (projectDir: string, spec: string) => Promise<void> = runNpmInstall
): Promise<AddResult> {
  const { name } = parsePackageSpec(packageSpec);


  const config = loadWefterConfig(projectDir);

  await install(projectDir, packageSpec);

  const packageDir = join(pluginsDirPath(projectDir, config), name);
  const validation = validatePluginDirectory(packageDir);
  if (!validation.valid) {
    return { added: false, alreadyDeclared: false, issues: validation.issues, exportedComponents: [], requiredConfigKeys: [], gradleConflicts: [] };
  }
  const manifest = validation.manifest!;

  const exportedComponents = (manifest.android?.manifestEntries ?? [])
    .filter((entry) => entry.exported)
    .map((entry) => `${entry.type} ${entry.name}`);

  const rawConfig = readRawConfig(projectDir);
  const declaredPluginConfig = (rawConfig.pluginConfig as Record<string, string> | undefined) ?? {};
  const requiredConfigKeys = extractRequiredPluginConfigKeys(manifest).filter((key) => declaredPluginConfig[key] === undefined);

  const existingPlugins = Array.isArray(rawConfig.plugins) ? (rawConfig.plugins as string[]) : [];
  if (existingPlugins.includes(name)) {
    return { added: false, alreadyDeclared: true, issues: [], exportedComponents, requiredConfigKeys, gradleConflicts: [] };
  }

  const alreadyResolvedPlugins = resolveRegisteredPlugins(pluginsDirPath(projectDir, config), existingPlugins);
  const { conflicts: gradleConflicts } = computeGradleMerge([...alreadyResolvedPlugins, { manifest, packageDir }]);

  const updatedConfig = { ...rawConfig, plugins: [...existingPlugins, name] };
  writeFileSync(join(projectDir, "wefter.config.json"), JSON.stringify(updatedConfig, null, 2) + "\n");

  return { added: true, alreadyDeclared: false, issues: [], exportedComponents, requiredConfigKeys, gradleConflicts };
}
