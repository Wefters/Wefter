import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveredPlugin } from "./scan-plugins.js";

function rewritePackageDeclarations(dir: string, packageName: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewritePackageDeclarations(entryPath, packageName);
    } else if (entry.name.endsWith(".kt")) {
      const content = readFileSync(entryPath, "utf-8");
      writeFileSync(entryPath, content.replace(/^package\s+[\w.]+/m, `package ${packageName}`));
    }
  }
}

export function copyAndroidNativeSource(plugins: DiscoveredPlugin[], destDir: string, packageName: string): void {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  for (const plugin of plugins) {
    const sourceDir = join(plugin.packageDir, "android");
    if (!existsSync(sourceDir)) {
      throw new Error(`Plugin "${plugin.manifest.name}" is missing its android/ folder — cannot weave native source.`);
    }
    cpSync(sourceDir, destDir, { recursive: true });
  }

  rewritePackageDeclarations(destDir, packageName);
}
