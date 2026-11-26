/**
 * `wefter add`: declares a plugin in `wefter.config.json` and `package.json`. Installing it is left to the
 * project's package manager, so the command prints the install command to run.
 */

import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { loadWefterConfig, pluginsDirPath } from "../config/project-paths.js";
import { fetchNpmPackageInfo } from "../plugins/npm-registry.js";

/** An npm package name, optionally scoped, with an optional version or tag. */
const PACKAGE_SPEC_PATTERN = /^(@[a-z0-9-]+\/[a-z0-9-]+|[a-z0-9-]+)(@[\w.\-^~]+)?$/;

/** Outcome of {@link add}. `installHint` is the command that installs the plugin. */
export interface AddResult {
  added: boolean;
  alreadyDeclared: boolean;
  issues: string[];
  resolvedVersion: string;
  installHint: string;
}

/**
 * A plugin package and how to depend on it.
 *
 * - `depSpec`: the value written to `package.json` (`^1.2.0` or `file:../plugin`).
 * - `installSpec`: what to pass to the package manager.
 */
export interface ResolvedPackageInfo {
  name: string;
  version: string;
  depSpec: string;
  installSpec: string;
}

/**
 * Works out which package `packageSpec` refers to.
 *
 * - A path (`./x`, `../x`, `/x`, `~/x`, `file:` or `link:`) or an existing folder is a local plugin, read
 *   from its `package.json` (or `plugin.json`) and referenced by a relative path.
 * - Anything else is looked up on npm. When the registry is unreachable, an already installed copy in
 *   `node_modules` is used instead, keeping a symlinked (linked) package as a `file:` reference.
 *
 * @throws {Error} When the folder or package cannot be found, or the spec is not valid.
 */
export async function resolvePackageInfo(projectDir: string, packageSpec: string): Promise<ResolvedPackageInfo> {
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

    let name: string;
    let version: string;

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

/** `wefter.config.json` as plain JSON, without defaults, so it can be rewritten as the user wrote it. */
function readRawConfig(projectDir: string): Record<string, unknown> {
  const path = join(projectDir, "wefter.config.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

/**
 * Adds the plugin to `dependencies` unless it is already there.
 *
 * @returns Whether `package.json` was changed.
 */
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

/** Adds a plugin to the project. Does nothing if it is already declared. */
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

/** The install command for the project's package manager, detected from its lockfile. */
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
