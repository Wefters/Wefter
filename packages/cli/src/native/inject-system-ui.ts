/**
 * Applies `profile`, `systemBars`, `gestures`, `audio` and `text` from `wefter.config.json` to both native
 * projects, as one JSON value each shell reads at start (`SystemUI.kt`, `SystemUI.swift`).
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { AppProfile, GestureArea, WefterConfig } from "../config/wefter-config-schema.js";

export const ANDROID_SYSTEM_UI_START = "// WEFTER-SYSTEM-UI-CONFIG-START";
export const ANDROID_SYSTEM_UI_END = "// WEFTER-SYSTEM-UI-CONFIG-END";
export const IOS_SYSTEM_UI_START = "// WEFTER-SYSTEM-UI-CONFIG-START";
export const IOS_SYSTEM_UI_END = "// WEFTER-SYSTEM-UI-CONFIG-END";
export const IOS_SYSTEM_UI_PLIST_START = "<!-- WEFTER-SYSTEM-UI-START -->";
export const IOS_SYSTEM_UI_PLIST_END = "<!-- WEFTER-SYSTEM-UI-END -->";

/** The settings the shells read, with the profile's defaults applied. */
export interface ResolvedSystemUI {
  profile: AppProfile;
  barsHidden: boolean;
  icons: "auto" | "dark" | "light";
  swipeBack: "history" | "page" | false;
  zoom: boolean;
  longPress: boolean;
  overscroll: boolean;
  edgeProtection: boolean | GestureArea[];
  autoplay: boolean;
  silentSwitch: "auto" | "respect" | "ignore";
  followSystemTextSize: boolean;
}

type ProfileDefaults = Omit<ResolvedSystemUI, "profile">;

/** What each profile starts with; any setting in the config replaces its default. */
export const PROFILE_DEFAULTS: Record<AppProfile, ProfileDefaults> = {
  app: {
    barsHidden: false,
    icons: "auto",
    swipeBack: "history",
    zoom: true,
    longPress: true,
    overscroll: true,
    edgeProtection: false,
    autoplay: false,
    silentSwitch: "auto",
    followSystemTextSize: true,
  },
  game: {
    barsHidden: true,
    icons: "auto",
    swipeBack: false,
    zoom: false,
    longPress: false,
    overscroll: false,
    edgeProtection: true,
    autoplay: true,
    silentSwitch: "auto",
    followSystemTextSize: false,
  },
};

/** The profile's defaults, replaced by what the config sets. */
export function resolveSystemUI(
  config: Pick<WefterConfig, "profile" | "systemBars" | "gestures" | "audio" | "text">,
): ResolvedSystemUI {
  const profile = config.profile ?? "app";
  const defaults = PROFILE_DEFAULTS[profile];
  const gestures = config.gestures ?? {};
  return {
    profile,
    barsHidden: config.systemBars?.hidden ?? defaults.barsHidden,
    icons: config.systemBars?.icons ?? defaults.icons,
    swipeBack: gestures.swipeBack ?? defaults.swipeBack,
    zoom: gestures.zoom ?? defaults.zoom,
    longPress: gestures.longPress ?? defaults.longPress,
    overscroll: gestures.overscroll ?? defaults.overscroll,
    edgeProtection: gestures.edgeProtection ?? defaults.edgeProtection,
    autoplay: config.audio?.autoplay ?? defaults.autoplay,
    silentSwitch: config.audio?.silentSwitch ?? defaults.silentSwitch,
    followSystemTextSize: config.text?.followSystemSize ?? defaults.followSystemTextSize,
  };
}

/** The JSON the shells read: everything but the profile's name. */
function shellJson(resolved: ResolvedSystemUI): string {
  const { profile: _profile, ...settings } = resolved;
  return JSON.stringify(settings);
}

/**
 * A one-line summary of the settings that differ from an ordinary app, for sync's output, or `null` when
 * there are none.
 */
export function describeSystemUI(resolved: ResolvedSystemUI): string | null {
  const app = PROFILE_DEFAULTS.app;
  const changes: string[] = [];
  if (resolved.barsHidden !== app.barsHidden) changes.push(resolved.barsHidden ? "bars hidden" : "bars shown");
  if (resolved.icons !== app.icons) changes.push(`${resolved.icons} bar icons`);
  if (resolved.swipeBack !== app.swipeBack) {
    changes.push(resolved.swipeBack === false ? "no swipe back" : `swipe back to ${resolved.swipeBack}`);
  }
  if (resolved.zoom !== app.zoom) changes.push(resolved.zoom ? "zoom" : "no zoom");
  if (resolved.longPress !== app.longPress) changes.push(resolved.longPress ? "long press" : "no long press");
  if (resolved.overscroll !== app.overscroll) changes.push(resolved.overscroll ? "overscroll" : "no overscroll");
  if (resolved.edgeProtection !== app.edgeProtection) {
    changes.push(
      Array.isArray(resolved.edgeProtection)
        ? `${resolved.edgeProtection.length} protected areas`
        : resolved.edgeProtection
          ? "protected edges"
          : "unprotected edges",
    );
  }
  if (resolved.autoplay !== app.autoplay) changes.push(resolved.autoplay ? "autoplay" : "no autoplay");
  if (resolved.silentSwitch !== app.silentSwitch) changes.push(`silent switch: ${resolved.silentSwitch}`);
  if (resolved.followSystemTextSize !== app.followSystemTextSize) {
    changes.push(resolved.followSystemTextSize ? "system text size" : "fixed text size");
  }
  if (changes.length === 0 && resolved.profile === "app") return null;
  return `${resolved.profile} profile${changes.length > 0 ? `: ${changes.join(", ")}` : ""}`;
}

/**
 * Replaces the block between `start` and `end` with `block`. Projects that predate the markers (ejected
 * ones) get it added by `add`.
 */
function replaceBlock(source: string, start: string, end: string, block: string, add: (source: string) => string) {
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  return pattern.test(source) ? source.replace(pattern, () => block) : add(source);
}

/** Writes the `SYSTEM_UI` build config field. */
export function injectSystemUIAndroid(buildGradlePath: string, resolved: ResolvedSystemUI): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  const field = JSON.stringify(JSON.stringify(shellJson(resolved)));
  const block = [
    ANDROID_SYSTEM_UI_START,
    `        buildConfigField("String", "SYSTEM_UI", ${field})`,
    `        ${ANDROID_SYSTEM_UI_END}`,
  ].join("\n");
  const next = replaceBlock(current, ANDROID_SYSTEM_UI_START, ANDROID_SYSTEM_UI_END, block, (source) => {
    if (!/defaultConfig\s*\{/.test(source)) throw new Error(`No defaultConfig block found in ${buildGradlePath}`);
    return source.replace(/(defaultConfig\s*\{)/, (match) => `${match}\n        ${block}\n`);
  });
  writeFileSync(buildGradlePath, next, "utf-8");
}

/**
 * Writes `systemUI` into `BuildConfig.swift`, and `UIStatusBarHidden` into `Info.plist` while the bars are
 * hidden, so they are hidden from launch.
 */
export function injectSystemUIIos(buildConfigPath: string, infoPlistPath: string, resolved: ResolvedSystemUI): void {
  const buildConfig = readFileSync(buildConfigPath, "utf-8");
  const block = [
    IOS_SYSTEM_UI_START,
    `    static let systemUI = ${JSON.stringify(shellJson(resolved))}`,
    `    ${IOS_SYSTEM_UI_END}`,
  ].join("\n");
  const nextConfig = replaceBlock(buildConfig, IOS_SYSTEM_UI_START, IOS_SYSTEM_UI_END, block, (source) => {
    const enumEnd = source.lastIndexOf("}");
    if (enumEnd === -1) throw new Error(`No BuildConfig declaration found in ${buildConfigPath}`);
    return `${source.slice(0, enumEnd).trimEnd()}\n\n    ${block}\n${source.slice(enumEnd)}`;
  });
  writeFileSync(buildConfigPath, nextConfig, "utf-8");

  const plist = readFileSync(infoPlistPath, "utf-8");
  const entries = resolved.barsHidden ? "\t<key>UIStatusBarHidden</key>\n\t<true/>\n" : "";
  const plistBlock = `${IOS_SYSTEM_UI_PLIST_START}\n${entries}\t${IOS_SYSTEM_UI_PLIST_END}`;
  const nextPlist = replaceBlock(plist, IOS_SYSTEM_UI_PLIST_START, IOS_SYSTEM_UI_PLIST_END, plistBlock, (source) => {
    const dictEnd = source.lastIndexOf("</dict>");
    if (dictEnd === -1) throw new Error(`No <dict> found in ${infoPlistPath}`);
    return `${source.slice(0, dictEnd)}\t${plistBlock}\n${source.slice(dictEnd)}`;
  });
  writeFileSync(infoPlistPath, nextPlist, "utf-8");
}
