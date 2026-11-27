/**
 * Checks on the built web app before it is shipped inside a release: leftover source maps, addresses of a
 * development machine, and files from other sites that the app's Content Security Policy blocks (it allows
 * only the app's own scripts, styles and fonts, so a Google Fonts stylesheet or a CDN script silently fails).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

/** Largest file read for the content checks; bigger files (videos, models) are skipped. */
const MAX_SCANNED_BYTES = 8 * 1024 * 1024;

/** File types whose contents are checked. */
const SCANNED_EXTENSIONS = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".css", ".json"]);

/**
 * `http(s)://` addresses of a development machine: this machine with a port (`localhost:5173`; a bare
 * `http://localhost` is a common library fallback, not a dev server), or a local network address.
 */
const DEV_ADDRESS_PATTERN =
  /https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+|(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?)(?:\/[^\s"'`)<>]*)?/g;

/** Kinds of outside resource the Content Security Policy blocks. */
export type BlockedResourceType = "stylesheet" | "script" | "font" | "frame";

/** An outside resource referenced from the web app. */
export interface BlockedResource {
  url: string;
  type: BlockedResourceType;
}

/** What {@link checkWebBuild} found. */
export interface WebBuildFindings {
  indexHtmlMissing: boolean;
  sourceMaps: string[];
  devAddresses: { file: string; address: string }[];
  blockedResources: (BlockedResource & { file: string })[];
}

/** Every file under `dir`. */
function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

/** The value of `name="…"` in an HTML tag, or `undefined`. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/** Whether a URL points to another site (`https://…`, `http://…` or `//…`). */
function isExternal(url: string | undefined): url is string {
  return Boolean(url && /^(?:https?:)?\/\//i.test(url.trim()));
}

/** Outside stylesheets, scripts, fonts and frames referenced by an HTML file. */
function blockedInHtml(html: string): BlockedResource[] {
  const found: BlockedResource[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const href = attribute(tag, "href");
    if (!isExternal(href)) continue;
    const rel = (attribute(tag, "rel") ?? "").toLowerCase();
    const as = (attribute(tag, "as") ?? "").toLowerCase();
    if (rel.split(/\s+/).includes("stylesheet")) found.push({ url: href, type: "stylesheet" });
    else if (/preload|modulepreload/.test(rel) && (as === "style" || as === "script" || as === "font")) {
      found.push({ url: href, type: as === "style" ? "stylesheet" : (as as "script" | "font") });
    }
  }
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const src = attribute(tag, "src");
    if (isExternal(src)) found.push({ url: src, type: "script" });
  }
  for (const tag of html.match(/<iframe\b[^>]*>/gi) ?? []) {
    const src = attribute(tag, "src");
    if (isExternal(src)) found.push({ url: src, type: "frame" });
  }
  return found;
}

/** Outside stylesheets (`@import`) and fonts (`url()` to a font file) referenced by a CSS file. */
function blockedInCss(css: string): BlockedResource[] {
  const found: BlockedResource[] = [];
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']?((?:https?:)?\/\/[^"')\s;]+)/gi)) {
    found.push({ url: match[1], type: "stylesheet" });
  }
  for (const match of css.matchAll(
    /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+\.(?:woff2?|ttf|otf|eot)(?:[?#][^"')\s]*)?)/gi,
  )) {
    found.push({ url: match[1], type: "font" });
  }
  return found;
}

/**
 * Checks the built web app in `webDir`: that `index.html` exists, and for source maps, development
 * addresses and outside resources the Content Security Policy blocks.
 */
export function checkWebBuild(webDir: string): WebBuildFindings {
  const findings: WebBuildFindings = {
    indexHtmlMissing: false,
    sourceMaps: [],
    devAddresses: [],
    blockedResources: [],
  };
  if (!existsSync(webDir) || !existsSync(join(webDir, "index.html"))) {
    findings.indexHtmlMissing = true;
    if (!existsSync(webDir)) return findings;
  }

  for (const path of listFiles(webDir)) {
    const file = relative(webDir, path);
    const extension = extname(path).toLowerCase();
    if (extension === ".map") {
      findings.sourceMaps.push(file);
      continue;
    }
    if (!SCANNED_EXTENSIONS.has(extension) || statSync(path).size > MAX_SCANNED_BYTES) continue;

    const contents = readFileSync(path, "utf-8");
    for (const match of new Set(contents.match(DEV_ADDRESS_PATTERN) ?? [])) {
      findings.devAddresses.push({ file, address: match });
    }
    if (extension === ".html" || extension === ".htm") {
      findings.blockedResources.push(...blockedInHtml(contents).map((r) => ({ ...r, file })));
    } else if (extension === ".css") {
      findings.blockedResources.push(...blockedInCss(contents).map((r) => ({ ...r, file })));
    }
  }
  return findings;
}

/** The host of a URL, for grouping findings. */
function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url).host;
  } catch {
    return url;
  }
}

/** The findings as warning messages, a few examples each. */
export function webBuildWarnings(findings: WebBuildFindings, webDirName: string): string[] {
  const warnings: string[] = [];
  if (findings.sourceMaps.length > 0) {
    warnings.push(
      `${findings.sourceMaps.length} source map file(s) in ${webDirName} (such as ${findings.sourceMaps[0]}) would ship your original source code; turn off source maps for release builds`,
    );
  }
  if (findings.devAddresses.length > 0) {
    const examples = [...new Set(findings.devAddresses.map((d) => d.address))].slice(0, 3);
    warnings.push(
      `the web app contains development addresses that will not work on users' phones: ${examples.join(", ")} (in ${findings.devAddresses[0].file})`,
    );
  }
  if (findings.blockedResources.length > 0) {
    const hosts = [...new Set(findings.blockedResources.map((r) => hostOf(r.url)))].slice(0, 4);
    const types = [...new Set(findings.blockedResources.map((r) => r.type))].join(", ");
    warnings.push(
      `the app's Content Security Policy blocks ${types} from other sites, so these will not load: ${hosts.join(", ")}; bundle them with the web app instead`,
    );
  }
  return warnings;
}
