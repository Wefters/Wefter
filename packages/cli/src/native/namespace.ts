/** Moves the Android shell from the template's `dev.wefter.bridge` package to the app's own namespace. */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Package and folder the Android template ships with. */
const TEMPLATE_NAMESPACE = "dev.wefter.bridge";
const TEMPLATE_PACKAGE_PATH = "dev/wefter/bridge";

/** The template's `namespace = …` line in `build.gradle.kts`. */
const NAMESPACE_FIELD_PATTERN = /namespace\s*=\s*"dev\.wefter\.bridge"/;

/**
 * Sets the Android namespace in `build.gradle.kts`.
 *
 * @throws {Error} When the template namespace line is not found.
 */
export function injectNamespace(buildGradlePath: string, namespace: string): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  if (!NAMESPACE_FIELD_PATTERN.test(current)) {
    throw new Error(`Could not find the template namespace declaration in ${buildGradlePath}`);
  }
  writeFileSync(buildGradlePath, current.replace(NAMESPACE_FIELD_PATTERN, `namespace = "${namespace}"`));
}

/** Changes `package dev.wefter.bridge` to `namespace` in every Kotlin file under `dir`. */
function rewritePackageDeclarations(dir: string, namespace: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewritePackageDeclarations(entryPath, namespace);
    } else if (entry.name.endsWith(".kt")) {
      const content = readFileSync(entryPath, "utf-8");
      writeFileSync(entryPath, content.replace(`package ${TEMPLATE_NAMESPACE}`, `package ${namespace}`));
    }
  }
}

/**
 * Rewrites the package declarations under one source root and moves the files to the folder that matches
 * the new package.
 */
export function weaveJavaNamespace(javaSrcRoot: string, namespace: string): void {
  const templateDir = join(javaSrcRoot, TEMPLATE_PACKAGE_PATH);
  rewritePackageDeclarations(templateDir, namespace);

  if (namespace === TEMPLATE_NAMESPACE) return;

  const stagingDir = join(javaSrcRoot, "__wefter_namespace_staging__");
  rmSync(stagingDir, { recursive: true, force: true });
  renameSync(templateDir, stagingDir);

  rmSync(join(javaSrcRoot, "dev"), { recursive: true, force: true });

  const targetDir = join(javaSrcRoot, ...namespace.split("."));
  mkdirSync(dirname(targetDir), { recursive: true });
  renameSync(stagingDir, targetDir);
}

/**
 * Applies {@link weaveJavaNamespace} to every source set (`main`, `debug`, …) that contains template code.
 */
export function weaveAndroidNamespace(appModuleDir: string, namespace: string): void {
  const srcDir = join(appModuleDir, "src");
  for (const variant of readdirSync(srcDir, { withFileTypes: true })) {
    if (!variant.isDirectory()) continue;
    const javaSrcRoot = join(srcDir, variant.name, "java");
    if (!existsSync(join(javaSrcRoot, TEMPLATE_PACKAGE_PATH))) continue;
    weaveJavaNamespace(javaSrcRoot, namespace);
  }
}
