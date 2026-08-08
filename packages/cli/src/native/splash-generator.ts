import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ResolvedSplash } from "./resolve-splash.js";

export function generateSplash(projectDir: string, resolved: ResolvedSplash, webAssetsDir: string): void {
  if (!resolved.enabled) return;

  const sourcePath = resolve(projectDir, resolved.html);
  if (!existsSync(sourcePath)) {
    throw new Error(`splash.html not found at ${sourcePath}`);
  }

  mkdirSync(webAssetsDir, { recursive: true });
  copyFileSync(sourcePath, join(webAssetsDir, "splash.html"));
}
