import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWefterConfig, pluginsDirPath } from "../config/project-paths.js";
import { fetchNpmPackageInfo } from "../plugins/npm-registry.js";

const PACKAGE_SPEC_PATTERN = /^(@[a-z0-9-]+\/[a-z0-9-]+|[a-z0-9-]+)(@[\w.\-^~]+)?$/;

export interface AddResult {
  added: boolean;
  alreadyDeclared: boolean;
  issues: string[];
  resolvedVersion: string;
  installHint: string;
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

function addToPackageJsonDeps(projectDir: string, name: string, version: string): boolean {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return false;

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;

  if (deps[name]) return false;

  deps[name] = `^${version}`;
  pkg.dependencies = deps;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  return true;
}

export async function add(projectDir: string, packageSpec: string): Promise<AddResult> {
  const { name } = parsePackageSpec(packageSpec);

  const config = loadWefterConfig(projectDir);
  void pluginsDirPath(projectDir, config);

  const rawConfig = readRawConfig(projectDir);
  const existingPlugins = Array.isArray(rawConfig.plugins) ? (rawConfig.plugins as string[]) : [];
  if (existingPlugins.includes(name)) {
    return {
      added: false,
      alreadyDeclared: true,
      issues: [],
      resolvedVersion: "",
      installHint: "",
    };
  }

  const pkgInfo = await fetchNpmPackageInfo(packageSpec);

  addToPackageJsonDeps(projectDir, pkgInfo.name, pkgInfo.version);

  const updatedConfig = { ...rawConfig, plugins: [...existingPlugins, name] };
  writeFileSync(join(projectDir, "wefter.config.json"), JSON.stringify(updatedConfig, null, 2) + "\n");

  const installHint = buildInstallHint(projectDir, pkgInfo.name, pkgInfo.version);

  return {
    added: true,
    alreadyDeclared: false,
    issues: [],
    resolvedVersion: pkgInfo.version,
    installHint,
  };
}

function buildInstallHint(projectDir: string, name: string, version: string): string {
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) {
    return `pnpm add ${name}@${version}`;
  }
  if (existsSync(join(projectDir, "yarn.lock"))) {
    return `yarn add ${name}@${version}`;
  }
  if (existsSync(join(projectDir, "bun.lockb")) || existsSync(join(projectDir, "bun.lock"))) {
    return `bun add ${name}@${version}`;
  }
  return `npm install ${name}@${version}`;
}
