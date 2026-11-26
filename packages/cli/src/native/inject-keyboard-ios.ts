/** Applies the `keyboard` options from `wefter.config.json` to the iOS project. */

import { readFileSync, writeFileSync } from "node:fs";

export const IOS_KEYBOARD_CONFIG_START = "// WEFTER-KEYBOARD-CONFIG-START";
export const IOS_KEYBOARD_CONFIG_END = "// WEFTER-KEYBOARD-CONFIG-END";

/**
 * Writes the `formAccessoryBar` constant into `BuildConfig.swift`, between the `WEFTER-KEYBOARD-CONFIG`
 * markers. Projects that predate the markers get them added at the end of `BuildConfig`.
 *
 * @param accessoryBar Whether web forms show the bar above the keyboard (previous, next and Done).
 */
export function injectKeyboardConfigIos(buildConfigPath: string, accessoryBar: boolean): void {
  const current = readFileSync(buildConfigPath, "utf-8");
  const block = `${IOS_KEYBOARD_CONFIG_START}\n    static let formAccessoryBar = ${accessoryBar}\n    ${IOS_KEYBOARD_CONFIG_END}`;
  const pattern = new RegExp(`${IOS_KEYBOARD_CONFIG_START}[\\s\\S]*?${IOS_KEYBOARD_CONFIG_END}`);

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
