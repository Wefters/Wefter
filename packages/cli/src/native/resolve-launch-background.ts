import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { WefterConfig } from "../config/wefter-config-schema.js";

export const DEFAULT_LAUNCH_BACKGROUND = "#FFFFFF";

const STYLE_TAG_PATTERN = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const REF_PATTERN = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
const BACKGROUND_PATTERN = /\bbackground(?:-color)?\s*:\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\b/;

function isLocalCssRef(ref: string): boolean {
  if (ref.startsWith("#") || ref.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false;
  return ref.split(/[?#]/)[0].toLowerCase().endsWith(".css");
}

function normalizeHex(hex: string): string {
  if (hex.length === 4) {
    const [, r, g, b] = hex;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return hex;
}

function extractBackgroundColor(css: string): string | null {
  const bodyBlock = css.match(/\bbody\s*\{([^}]*)\}/i);
  const rootBlock = css.match(/(?::root|html)\s*\{([^}]*)\}/i);
  for (const block of [bodyBlock, rootBlock]) {
    const match = block?.[1].match(BACKGROUND_PATTERN);
    if (match) return normalizeHex(match[1]);
  }
  return null;
}

export function detectSplashBackgroundColor(splashSourceDir: string): string | null {
  const indexPath = join(splashSourceDir, "index.html");
  if (!existsSync(indexPath)) return null;
  const html = readFileSync(indexPath, "utf-8");

  let css = "";
  for (const match of html.matchAll(STYLE_TAG_PATTERN)) {
    css += match[1] + "\n";
  }
  for (const match of html.matchAll(REF_PATTERN)) {
    if (!isLocalCssRef(match[1])) continue;
    const cssPath = resolve(dirname(indexPath), match[1].split(/[?#]/)[0]);
    if (existsSync(cssPath)) css += readFileSync(cssPath, "utf-8") + "\n";
  }

  return extractBackgroundColor(css);
}

export function resolveLaunchBackground(config: WefterConfig, projectDir: string): string {
  if (config.launchBackground) return config.launchBackground;

  if (config.splash) {
    const detected = detectSplashBackgroundColor(resolve(projectDir, config.splash.source));
    if (detected) return detected;
  }

  return DEFAULT_LAUNCH_BACKGROUND;
}
