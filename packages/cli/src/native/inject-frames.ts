/**
 * Applies `frames` from `wefter.config.json` to both native projects: the sites the app's pages may embed
 * (added to the Content Security Policy's `frame-src`) and the plugin methods some of them may call
 * directly through the bridge.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { FramesConfig } from "../config/wefter-config-schema.js";

const ANDROID_START = "// WEFTER-FRAMES-CONFIG-START";
const ANDROID_END = "// WEFTER-FRAMES-CONFIG-END";
const IOS_START = "// WEFTER-FRAMES-CONFIG-START";
const IOS_END = "// WEFTER-FRAMES-CONFIG-END";

/** What the shells need from `frames`. */
export interface ResolvedFrames {
  /** `frame-src` sources: every allowed site, and every site granted plugins. */
  sources: string[];
  /** Plugin methods by origin. */
  grants: Record<string, string[]>;
}

/** Resolves `frames`, adding sites granted plugins to the sites allowed to load. */
export function resolveFrames(frames: FramesConfig | undefined): ResolvedFrames {
  const grants = frames?.plugins ?? {};
  const sources = [...new Set([...(frames?.allow ?? []), ...Object.keys(grants)])];
  return { sources, grants };
}

/** A Kotlin string literal for a `buildConfigField` value, which is itself Kotlin source. */
function kotlinStringField(value: string): string {
  return JSON.stringify(JSON.stringify(value));
}

/** Writes the `FRAME_SOURCES` and `FRAME_PLUGIN_GRANTS` build config fields. */
export function injectFramesAndroid(buildGradlePath: string, frames: ResolvedFrames): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  const pattern = new RegExp(`${ANDROID_START}[\\s\\S]*?${ANDROID_END}`);
  if (!pattern.test(current)) throw new Error(`No ${ANDROID_START} marker found in ${buildGradlePath}`);
  const grants = Object.keys(frames.grants).length > 0 ? JSON.stringify(frames.grants) : "";
  const block = [
    ANDROID_START,
    `        buildConfigField("String", "FRAME_SOURCES", ${kotlinStringField(frames.sources.join(" "))})`,
    `        buildConfigField("String", "FRAME_PLUGIN_GRANTS", ${kotlinStringField(grants)})`,
    `        ${ANDROID_END}`,
  ].join("\n");
  writeFileSync(
    buildGradlePath,
    current.replace(pattern, () => block),
  );
}

/** Writes `frameSources` and `framePluginGrants` into `BuildConfig.swift`. */
export function injectFramesIos(buildConfigPath: string, frames: ResolvedFrames): void {
  const current = readFileSync(buildConfigPath, "utf-8");
  const pattern = new RegExp(`${IOS_START}[\\s\\S]*?${IOS_END}`);
  if (!pattern.test(current)) throw new Error(`No ${IOS_START} marker found in ${buildConfigPath}`);
  const entries = Object.entries(frames.grants).map(
    ([origin, methods]) => `${JSON.stringify(origin)}: [${methods.map((m) => JSON.stringify(m)).join(", ")}]`,
  );
  const grants = entries.length > 0 ? `[${entries.join(", ")}]` : "[:]";
  const block = [
    IOS_START,
    `    static let frameSources = ${JSON.stringify(frames.sources.join(" "))}`,
    `    static let framePluginGrants: [String: [String]] = ${grants}`,
    `    ${IOS_END}`,
  ].join("\n");
  writeFileSync(
    buildConfigPath,
    current.replace(pattern, () => block),
  );
}

/**
 * Problems with `frames` sync should warn about: granted plugins the app doesn't include. Wildcards and
 * malformed origins are already refused by the config schema.
 */
export function framesWarnings(frames: ResolvedFrames, pluginNames: string[]): string[] {
  const known = new Set(pluginNames);
  const warnings: string[] = [];
  for (const [origin, methods] of Object.entries(frames.grants)) {
    for (const method of methods) {
      const plugin = method.split(".")[0];
      if (!known.has(plugin))
        warnings.push(`frames.plugins grants ${origin} "${method}", but the app has no "${plugin}" plugin`);
    }
  }
  return warnings;
}
