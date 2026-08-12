import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ResolvedSplash } from "./resolve-splash.js";
import logger from "../utils/logger.js";

const REF_PATTERN = /(?:src|href)\s*=\s*["']([^"']+)["']/g;

function isLocalRef(ref: string): boolean {
  if (ref.startsWith("#")) return false;
  if (ref.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false;
  return true;
}

function listHtmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listHtmlFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) out.push(full);
  }
  return out;
}

function warnBrokenReferences(sourceDir: string): void {
  for (const htmlFile of listHtmlFiles(sourceDir)) {
    const html = readFileSync(htmlFile, "utf-8");
    for (const match of html.matchAll(REF_PATTERN)) {
      const ref = match[1];
      if (!isLocalRef(ref)) continue;
      const target = resolve(dirname(htmlFile), ref.split(/[?#]/)[0]);
      if (!existsSync(target)) {
        logger.warn(
          `splash: ${relative(sourceDir, htmlFile)} references "${ref}", which doesn't exist in the splash folder.`,
        );
      }
    }
  }
}

export function generateSplash(projectDir: string, resolved: ResolvedSplash, webAssetsDir: string): void {
  if (!resolved.enabled) return;

  const sourceDir = resolve(projectDir, resolved.source);
  if (!existsSync(sourceDir) || !lstatSync(sourceDir).isDirectory()) {
    throw new Error(`splash folder not found at ${sourceDir}`);
  }

  const indexPath = join(sourceDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`splash folder at ${sourceDir} is missing an index.html`);
  }

  warnBrokenReferences(sourceDir);

  const destDir = join(webAssetsDir, "splash");
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceDir, destDir, { recursive: true });
}
