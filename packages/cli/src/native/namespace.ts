import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const TEMPLATE_NAMESPACE = "dev.wefter.bridge";
const TEMPLATE_PACKAGE_PATH = "dev/wefter/bridge";

const NAMESPACE_FIELD_PATTERN = /namespace\s*=\s*"dev\.wefter\.bridge"/;

export function injectNamespace(buildGradlePath: string, namespace: string): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  if (!NAMESPACE_FIELD_PATTERN.test(current)) {
    throw new Error(`Could not find the template namespace declaration in ${buildGradlePath}`);
  }
  writeFileSync(buildGradlePath, current.replace(NAMESPACE_FIELD_PATTERN, `namespace = "${namespace}"`));
}

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

export function weaveAndroidNamespace(appModuleDir: string, namespace: string): void {
  const srcDir = join(appModuleDir, "src");
  for (const variant of readdirSync(srcDir, { withFileTypes: true })) {
    if (!variant.isDirectory()) continue;
    const javaSrcRoot = join(srcDir, variant.name, "java");
    if (!existsSync(join(javaSrcRoot, TEMPLATE_PACKAGE_PATH))) continue;
    weaveJavaNamespace(javaSrcRoot, namespace);
  }
}
