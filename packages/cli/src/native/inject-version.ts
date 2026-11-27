/**
 * Writes the app version and build number into the native projects: `versionName` / `versionCode` in the
 * Android `build.gradle.kts`, and `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in the iOS
 * `Shared.xcconfig`, which `Info.plist` reads.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AppVersion } from "../app-build/app-version.js";

const IOS_VERSION_START = "// WEFTER-VERSION-START";
const IOS_VERSION_END = "// WEFTER-VERSION-END";

/**
 * Sets `versionCode` and `versionName` in the Android app module's `defaultConfig`.
 *
 * @throws {Error} When the file has no `versionCode` or `versionName` line.
 */
export function injectVersionAndroid(
  buildGradlePath: string,
  appVersion: Pick<AppVersion, "version" | "buildNumber">,
): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  const codePattern = /^(\s*)versionCode\s*=\s*\d+.*$/m;
  const namePattern = /^(\s*)versionName\s*=\s*".*".*$/m;
  if (!codePattern.test(current) || !namePattern.test(current)) {
    throw new Error(`No versionCode / versionName found in ${buildGradlePath}`);
  }
  const updated = current
    .replace(codePattern, `$1versionCode = ${appVersion.buildNumber}`)
    .replace(namePattern, `$1versionName = ${JSON.stringify(appVersion.version)}`);
  if (updated !== current) writeFileSync(buildGradlePath, updated);
}

/**
 * Sets `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `Shared.xcconfig` (between the
 * `WEFTER-VERSION` markers, added when missing), and makes `Info.plist` read them, for projects whose
 * `Info.plist` still has the numbers written in.
 */
export function injectVersionIos(
  sharedXcconfigPath: string,
  infoPlistPath: string,
  appVersion: Pick<AppVersion, "version" | "buildNumber">,
): void {
  const block = [
    IOS_VERSION_START,
    `MARKETING_VERSION = ${appVersion.version}`,
    `CURRENT_PROJECT_VERSION = ${appVersion.buildNumber}`,
    IOS_VERSION_END,
  ].join("\n");

  const xcconfig = existsSync(sharedXcconfigPath) ? readFileSync(sharedXcconfigPath, "utf-8") : "";
  const markerPattern = new RegExp(`${IOS_VERSION_START}[\\s\\S]*?${IOS_VERSION_END}`);
  const updatedXcconfig = markerPattern.test(xcconfig)
    ? xcconfig.replace(markerPattern, block)
    : `${xcconfig}${xcconfig && !xcconfig.endsWith("\n") ? "\n" : ""}\n${block}\n`;
  if (updatedXcconfig !== xcconfig) writeFileSync(sharedXcconfigPath, updatedXcconfig);

  if (!existsSync(infoPlistPath)) return;
  const plist = readFileSync(infoPlistPath, "utf-8");
  const updatedPlist = plist
    .replace(/(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/, "$1$(MARKETING_VERSION)$2")
    .replace(/(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/, "$1$(CURRENT_PROJECT_VERSION)$2");
  if (updatedPlist !== plist) writeFileSync(infoPlistPath, updatedPlist);
}

/** xcodebuild settings that set the version on the command line, which wins over every project setting. */
export function versionBuildSettings(appVersion: Pick<AppVersion, "version" | "buildNumber">): string[] {
  return [`MARKETING_VERSION=${appVersion.version}`, `CURRENT_PROJECT_VERSION=${appVersion.buildNumber}`];
}
