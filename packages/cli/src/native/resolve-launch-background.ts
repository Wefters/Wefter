/** Picks the colour shown while the native app starts, before the web view has drawn anything. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { WefterConfig } from "../config/wefter-config-schema.js";

/** Used when nothing else gives a colour. */
export const DEFAULT_LAUNCH_BACKGROUND = "#FFFFFF";

/** Inline `<style>` blocks. */
const STYLE_TAG_PATTERN = /<style[^>]*>([\s\S]*?)<\/style>/gi;
/** `src` and `href` attributes. */
const REF_PATTERN = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
/** A `background` or `background-color` hex value. */
const BACKGROUND_PATTERN = /\bbackground(?:-color)?\s*:\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\b/;

/** Whether a reference is a local `.css` file rather than a URL or anchor. */
function isLocalCssRef(ref: string): boolean {
  if (ref.startsWith("#") || ref.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false;
  return ref.split(/[?#]/)[0].toLowerCase().endsWith(".css");
}

/** Expands `#abc` to `#aabbcc`. */
function normalizeHex(hex: string): string {
  if (hex.length === 4) {
    const [, r, g, b] = hex;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return hex;
}

/** The background colour of `body`, else of `:root` or `html`. */
function extractBackgroundColor(css: string): string | null {
  const bodyBlock = css.match(/\bbody\s*\{([^}]*)\}/i);
  const rootBlock = css.match(/(?::root|html)\s*\{([^}]*)\}/i);
  for (const block of [bodyBlock, rootBlock]) {
    const match = block?.[1].match(BACKGROUND_PATTERN);
    if (match) return normalizeHex(match[1]);
  }
  return null;
}

/**
 * Reads the splash page's background colour from its inline styles and local stylesheets, so the launch
 * screen blends into the splash.
 *
 * @returns A `#RRGGBB` colour, or `null` when none was found.
 */
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

/** The launch colour: `launchBackground` from the config, else the splash page's background, else white. */
export function resolveLaunchBackground(config: WefterConfig, projectDir: string): string {
  if (config.launchBackground) return config.launchBackground;

  if (config.splash) {
    const detected = detectSplashBackgroundColor(resolve(projectDir, config.splash.source));
    if (detected) return detected;
  }

  return DEFAULT_LAUNCH_BACKGROUND;
}
