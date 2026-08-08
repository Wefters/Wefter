import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export function copyWebAssets(projectDir: string, webDir: string, destDir: string): void {
  const sourceDir = join(projectDir, webDir);
  if (!existsSync(sourceDir)) {
    throw new Error(`webDir "${webDir}" not found. Run your frontend build first.`);
  }
  if (!existsSync(join(sourceDir, "index.html"))) {
    throw new Error(`No index.html found in "${webDir}".`);
  }

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });
}
