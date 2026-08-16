import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
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

export interface ResolvedPackageInfo {
  name: string;
  version: string;
  depSpec: string;
  installSpec: string;
}

export async function resolvePackageInfo(
  projectDir: string,
  packageSpec: string,
): Promise<ResolvedPackageInfo> {
  let scheme: "file:" | "link:" | null = null;
  let rawPath = packageSpec;
  let isExplicitPath = false;

  if (packageSpec.startsWith("file:")) {
    scheme = "file:";
    rawPath = packageSpec.slice(5);
    isExplicitPath = true;
  } else if (packageSpec.startsWith("link:")) {
    scheme = "link:";
    rawPath = packageSpec.slice(5);
    isExplicitPath = true;
  } else if (
    packageSpec.startsWith("./") ||
    packageSpec.startsWith("../") ||
    packageSpec.startsWith("/") ||
    packageSpec.startsWith("~")
  ) {
    isExplicitPath = true;
  }

  const absPath = isAbsolute(rawPath) ? rawPath : resolve(projectDir, rawPath);
  const pathExists = existsSync(absPath);
  const isDirectory = pathExists && statSync(absPath).isDirectory();

  if (isExplicitPath || isDirectory) {
    if (!pathExists || !isDirectory) {
      throw new Error(`Local plugin directory "${absPath}" does not exist.`);
    }

    const pkgJsonPath = join(absPath, "package.json");
    const pluginJsonPath = join(absPath, "plugin.json");

    let name = "";
    let version = "0.0.0";

    if (existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
      name = (pkg.name as string) || "";
      version = (pkg.version as string) || "0.0.0";
    } else if (existsSync(pluginJsonPath)) {
      const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf-8")) as Record<string, unknown>;
      name = (pluginJson.name as string) || "";
      version = (pluginJson.version as string) || "0.0.0";
    } else {
      throw new Error(`No package.json or plugin.json found in local repository at "${absPath}".`);
    }

    if (!name) {
      throw new Error(`Plugin at "${absPath}" is missing a "name" field in package.json or plugin.json.`);
    }

    let relPath = relative(projectDir, absPath);
    if (!relPath.startsWith(".") && !isAbsolute(relPath)) {
      relPath = "./" + relPath;
    }

    const prefix = scheme ?? "file:";
    const depSpec = `${prefix}${relPath}`;

    return {
      name,
      version,
      depSpec,
      installSpec: depSpec,
    };
  }

  if (PACKAGE_SPEC_PATTERN.test(packageSpec)) {
    try {
      const pkgInfo = await fetchNpmPackageInfo(packageSpec);
      return {
        name: pkgInfo.name,
        version: pkgInfo.version,
        depSpec: `^${pkgInfo.version}`,
        installSpec: `${pkgInfo.name}@${pkgInfo.version}`,
      };
    } catch (err) {
      const nodeModulesPkgPath = join(projectDir, "node_modules", packageSpec, "package.json");
      if (existsSync(nodeModulesPkgPath)) {
        const pkg = JSON.parse(readFileSync(nodeModulesPkgPath, "utf-8")) as Record<string, unknown>;
        const name = (pkg.name as string) || packageSpec;
        const version = (pkg.version as string) || "0.0.0";

        const pkgDir = join(projectDir, "node_modules", packageSpec);
        let depSpec = `^${version}`;
        let installSpec = `${name}@${version}`;

        if (lstatSync(pkgDir).isSymbolicLink()) {
          const realDir = realpathSync(pkgDir);
          let relPath = relative(projectDir, realDir);
          if (!relPath.startsWith(".")) relPath = "./" + relPath;
          depSpec = `file:${relPath}`;
          installSpec = depSpec;
        }

        return { name, version, depSpec, installSpec };
      }
      throw err;
    }
  }

  throw new Error(`"${packageSpec}" doesn't look like a valid npm package name or local repo path.`);
}

function readRawConfig(projectDir: string): Record<string, unknown> {
  const path = join(projectDir, "wefter.config.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

function addToPackageJsonDeps(projectDir: string, name: string, depSpec: string): boolean {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return false;

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;

  if (deps[name]) return false;

  deps[name] = depSpec;
  pkg.dependencies = deps;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  return true;
}

export async function add(projectDir: string, packageSpec: string): Promise<AddResult> {
  const resolvedInfo = await resolvePackageInfo(projectDir, packageSpec);

  const config = loadWefterConfig(projectDir);
  void pluginsDirPath(projectDir, config);

  const rawConfig = readRawConfig(projectDir);
  const existingPlugins = Array.isArray(rawConfig.plugins) ? (rawConfig.plugins as string[]) : [];
  if (existingPlugins.includes(resolvedInfo.name)) {
    return {
      added: false,
      alreadyDeclared: true,
      issues: [],
      resolvedVersion: resolvedInfo.version,
      installHint: "",
    };
  }

  addToPackageJsonDeps(projectDir, resolvedInfo.name, resolvedInfo.depSpec);

  const updatedConfig = { ...rawConfig, plugins: [...existingPlugins, resolvedInfo.name] };
  writeFileSync(join(projectDir, "wefter.config.json"), JSON.stringify(updatedConfig, null, 2) + "\n");

  const installHint = buildInstallHint(projectDir, resolvedInfo.installSpec);

  return {
    added: true,
    alreadyDeclared: false,
    issues: [],
    resolvedVersion: resolvedInfo.version,
    installHint,
  };
}

function buildInstallHint(projectDir: string, installSpec: string): string {
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) {
    return `pnpm add ${installSpec}`;
  }
  if (existsSync(join(projectDir, "yarn.lock"))) {
    return `yarn add ${installSpec}`;
  }
  if (existsSync(join(projectDir, "bun.lockb")) || existsSync(join(projectDir, "bun.lock"))) {
    return `bun add ${installSpec}`;
  }
  return `npm install ${installSpec}`;
}

