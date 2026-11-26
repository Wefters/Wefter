/** Applies `launchBackground` from `wefter.config.json` to the iOS project. */

import { readFileSync, writeFileSync } from "node:fs";

export const IOS_LAUNCH_BACKGROUND_START = "// WEFTER-LAUNCH-BACKGROUND-START";
export const IOS_LAUNCH_BACKGROUND_END = "// WEFTER-LAUNCH-BACKGROUND-END";

/** One colour channel of `#RRGGBB` as a 0–1 value, rounded to four decimals. */
function hexComponentToUnitFloat(hex: string, start: number): string {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return String(Math.round(value * 10000) / 10000);
}

/**
 * Sets the background colour of the launch screen storyboard.
 *
 * @throws {Error} When the storyboard has no background colour element.
 */
export function injectLaunchBackgroundIos(storyboardPath: string, hexColor: string): void {
  const current = readFileSync(storyboardPath, "utf-8");
  const pattern = /<color key="backgroundColor"[^>]*\/>/;
  if (!pattern.test(current)) {
    throw new Error(`No backgroundColor <color> element found in ${storyboardPath}`);
  }

  const red = hexComponentToUnitFloat(hexColor, 1);
  const green = hexComponentToUnitFloat(hexColor, 3);
  const blue = hexComponentToUnitFloat(hexColor, 5);
  const replacement = `<color key="backgroundColor" red="${red}" green="${green}" blue="${blue}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>`;

  writeFileSync(storyboardPath, current.replace(pattern, replacement));
}

/**
 * Writes the launch colour into `BuildConfig.swift`, between the `WEFTER-LAUNCH-BACKGROUND` markers, so the
 * web views can show it until their pages have painted. Projects that predate the markers get them added at
 * the end of `BuildConfig`.
 */
export function injectLaunchBackgroundBuildConfigIos(buildConfigPath: string, hexColor: string): void {
  const current = readFileSync(buildConfigPath, "utf-8");
  const red = hexComponentToUnitFloat(hexColor, 1);
  const green = hexComponentToUnitFloat(hexColor, 3);
  const blue = hexComponentToUnitFloat(hexColor, 5);
  const block =
    `${IOS_LAUNCH_BACKGROUND_START}\n` +
    `    static let launchBackground: (red: Double, green: Double, blue: Double) = (${red}, ${green}, ${blue})\n` +
    `    ${IOS_LAUNCH_BACKGROUND_END}`;
  const pattern = new RegExp(`${IOS_LAUNCH_BACKGROUND_START}[\\s\\S]*?${IOS_LAUNCH_BACKGROUND_END}`);

  let next: string;
  if (pattern.test(current)) {
    next = current.replace(pattern, block);
  } else {
    const enumEnd = current.lastIndexOf("}");
    if (enumEnd === -1) throw new Error(`No BuildConfig declaration found in ${buildConfigPath}`);
    next = `${current.slice(0, enumEnd).trimEnd()}\n\n    ${block}\n${current.slice(enumEnd)}`;
  }

  writeFileSync(buildConfigPath, next, "utf-8");
}
