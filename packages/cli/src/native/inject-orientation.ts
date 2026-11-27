/** Applies the `orientation` option from `wefter.config.json` to both native projects. */

import { readFileSync, writeFileSync } from "node:fs";
import type { AppOrientation } from "../config/wefter-config-schema.js";

/** Markers around the generated orientation settings in each native file. */
export const ANDROID_ORIENTATION_START = "// WEFTER-ORIENTATION-CONFIG-START";
export const ANDROID_ORIENTATION_END = "// WEFTER-ORIENTATION-CONFIG-END";

export const IOS_ORIENTATION_PLIST_START = "<!-- WEFTER-ORIENTATIONS-START -->";
export const IOS_ORIENTATION_PLIST_END = "<!-- WEFTER-ORIENTATIONS-END -->";

export const IOS_ORIENTATION_CONFIG_START = "// WEFTER-ORIENTATION-CONFIG-START";
export const IOS_ORIENTATION_CONFIG_END = "// WEFTER-ORIENTATION-CONFIG-END";

/** `Info.plist` orientations for a landscape-only app. */
const IOS_LANDSCAPE_ORIENTATIONS = `\t<key>UISupportedInterfaceOrientations</key>
\t<array>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t\t<string>UIInterfaceOrientationLandscapeRight</string>
\t</array>
\t<key>UISupportedInterfaceOrientations~ipad</key>
\t<array>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t\t<string>UIInterfaceOrientationLandscapeRight</string>
\t</array>`;

/** `Info.plist` orientations for a portrait app: portrait on iPhone; every orientation on iPad, as the App Store requires. */
const IOS_PORTRAIT_ORIENTATIONS = `\t<key>UISupportedInterfaceOrientations</key>
\t<array>
\t\t<string>UIInterfaceOrientationPortrait</string>
\t</array>
\t<key>UISupportedInterfaceOrientations~ipad</key>
\t<array>
\t\t<string>UIInterfaceOrientationPortrait</string>
\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t\t<string>UIInterfaceOrientationLandscapeRight</string>
\t</array>`;

/** `Info.plist` orientations for an app that rotates: the iOS defaults for iPhone and iPad. */
const IOS_ANY_ORIENTATIONS = `\t<key>UISupportedInterfaceOrientations</key>
\t<array>
\t\t<string>UIInterfaceOrientationPortrait</string>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t\t<string>UIInterfaceOrientationLandscapeRight</string>
\t</array>
\t<key>UISupportedInterfaceOrientations~ipad</key>
\t<array>
\t\t<string>UIInterfaceOrientationPortrait</string>
\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t\t<string>UIInterfaceOrientationLandscapeRight</string>
\t</array>`;

/** `android:screenOrientation` of `MainActivity` for each orientation; `any` leaves it out. */
const ANDROID_SCREEN_ORIENTATIONS: Record<AppOrientation, string | null> = {
  portrait: "portrait",
  landscape: "sensorLandscape",
  any: null,
};

/**
 * Sets `MainActivity`'s orientation in the manifest (portrait, or landscape either way up; none for `any`)
 * and the `LANDSCAPE` build config field. Android 16 ignores the lock on large screens such as tablets.
 * Projects that predate the markers get them added after the splash config.
 */
export function injectOrientationAndroid(
  manifestPath: string,
  buildGradlePath: string,
  orientation: AppOrientation,
): void {
  const landscape = orientation === "landscape";
  const screenOrientation = ANDROID_SCREEN_ORIENTATIONS[orientation];
  let manifest = readFileSync(manifestPath, "utf-8");
  const activityRegex = /(<activity\b[^>]*android:name="\.MainActivity"[^>]*>)/s;
  const match = manifest.match(activityRegex);

  if (match) {
    let activityTag = match[1];
    const orientationAttrRegex = /\s*android:screenOrientation="[^"]*"/;

    if (screenOrientation) {
      const attribute = `\n            android:screenOrientation="${screenOrientation}"`;
      if (orientationAttrRegex.test(activityTag)) {
        activityTag = activityTag.replace(orientationAttrRegex, attribute);
      } else {
        activityTag = activityTag.replace(/(android:name="\.MainActivity")/, `$1${attribute}`);
      }
    } else {
      activityTag = activityTag.replace(orientationAttrRegex, "");
    }

    manifest = manifest.replace(match[1], activityTag);
    writeFileSync(manifestPath, manifest, "utf-8");
  }

  let gradle = readFileSync(buildGradlePath, "utf-8");
  const gradleLine = `        buildConfigField("boolean", "LANDSCAPE", "${landscape}")`;
  const markerPattern = new RegExp(`(${ANDROID_ORIENTATION_START})[\\s\\S]*?(${ANDROID_ORIENTATION_END})`);

  if (markerPattern.test(gradle)) {
    gradle = gradle.replace(markerPattern, `$1\n${gradleLine}\n        $2`);
  } else {
    const splashEndPattern = /(\/\/ WEFTER-SPLASH-CONFIG-END)/;
    if (splashEndPattern.test(gradle)) {
      gradle = gradle.replace(
        splashEndPattern,
        `$1\n\n        ${ANDROID_ORIENTATION_START}\n${gradleLine}\n        ${ANDROID_ORIENTATION_END}`,
      );
    } else {
      gradle = gradle.replace(
        /(defaultConfig\s*\{)/,
        `$1\n        ${ANDROID_ORIENTATION_START}\n${gradleLine}\n        ${ANDROID_ORIENTATION_END}`,
      );
    }
  }

  writeFileSync(buildGradlePath, gradle, "utf-8");
}

/** `Info.plist` orientations for each orientation. */
const IOS_ORIENTATIONS: Record<AppOrientation, string> = {
  portrait: IOS_PORTRAIT_ORIENTATIONS,
  landscape: IOS_LANDSCAPE_ORIENTATIONS,
  any: IOS_ANY_ORIENTATIONS,
};

/**
 * Writes the supported orientations into `Info.plist` and the `landscape` constant into
 * `BuildConfig.swift`. Projects that predate the markers get them added.
 */
export function injectOrientationIos(
  infoPlistPath: string,
  buildConfigPath: string,
  orientation: AppOrientation,
): void {
  const landscape = orientation === "landscape";
  let plist = readFileSync(infoPlistPath, "utf-8");
  const orientationsBlock = IOS_ORIENTATIONS[orientation];
  const replacement = `${IOS_ORIENTATION_PLIST_START}\n${orientationsBlock}\n\t${IOS_ORIENTATION_PLIST_END}`;

  const markerPattern = new RegExp(`${IOS_ORIENTATION_PLIST_START}[\\s\\S]*?${IOS_ORIENTATION_PLIST_END}`);
  if (markerPattern.test(plist)) {
    plist = plist.replace(markerPattern, replacement);
  } else {
    const rawOrientationsPattern =
      /<key>UISupportedInterfaceOrientations<\/key>[\s\S]*?<\/array>[\s]*<key>UISupportedInterfaceOrientations~ipad<\/key>[\s\S]*?<\/array>/;
    if (rawOrientationsPattern.test(plist)) {
      plist = plist.replace(rawOrientationsPattern, replacement);
    } else {
      plist = plist.replace(/(<dict>)/, `$1\n${replacement}`);
    }
  }

  writeFileSync(infoPlistPath, plist, "utf-8");

  let buildConfig = readFileSync(buildConfigPath, "utf-8");
  const configLine = `    static let landscape = ${landscape}`;
  const configPattern = new RegExp(`${IOS_ORIENTATION_CONFIG_START}[\\s\\S]*?${IOS_ORIENTATION_CONFIG_END}`);

  if (configPattern.test(buildConfig)) {
    buildConfig = buildConfig.replace(
      configPattern,
      `${IOS_ORIENTATION_CONFIG_START}\n${configLine}\n    ${IOS_ORIENTATION_CONFIG_END}`,
    );
  } else {
    const splashEndPattern = /(\/\/ WEFTER-SPLASH-CONFIG-END)/;
    if (splashEndPattern.test(buildConfig)) {
      buildConfig = buildConfig.replace(
        splashEndPattern,
        `$1\n\n    ${IOS_ORIENTATION_CONFIG_START}\n${configLine}\n    ${IOS_ORIENTATION_CONFIG_END}`,
      );
    } else {
      buildConfig = buildConfig.replace(
        /(enum BuildConfig\s*\{)/,
        `$1\n    ${IOS_ORIENTATION_CONFIG_START}\n${configLine}\n    ${IOS_ORIENTATION_CONFIG_END}`,
      );
    }
  }

  writeFileSync(buildConfigPath, buildConfig, "utf-8");
}
