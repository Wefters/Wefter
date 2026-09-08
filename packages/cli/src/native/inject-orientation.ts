import { readFileSync, writeFileSync } from "node:fs";

export const ANDROID_ORIENTATION_START = "// WEFTER-ORIENTATION-CONFIG-START";
export const ANDROID_ORIENTATION_END = "// WEFTER-ORIENTATION-CONFIG-END";

export const IOS_ORIENTATION_PLIST_START = "<!-- WEFTER-ORIENTATIONS-START -->";
export const IOS_ORIENTATION_PLIST_END = "<!-- WEFTER-ORIENTATIONS-END -->";

export const IOS_ORIENTATION_CONFIG_START = "// WEFTER-ORIENTATION-CONFIG-START";
export const IOS_ORIENTATION_CONFIG_END = "// WEFTER-ORIENTATION-CONFIG-END";

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

const IOS_DEFAULT_ORIENTATIONS = `\t<key>UISupportedInterfaceOrientations</key>
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

export function injectOrientationAndroid(manifestPath: string, buildGradlePath: string, landscape: boolean): void {
  // 1. Update AndroidManifest.xml for MainActivity
  let manifest = readFileSync(manifestPath, "utf-8");
  const activityRegex = /(<activity\b[^>]*android:name="\.MainActivity"[^>]*>)/s;
  const match = manifest.match(activityRegex);

  if (match) {
    let activityTag = match[1];
    const orientationAttrRegex = /\s*android:screenOrientation="[^"]*"/;

    if (landscape) {
      if (orientationAttrRegex.test(activityTag)) {
        activityTag = activityTag.replace(
          orientationAttrRegex,
          '\n            android:screenOrientation="sensorLandscape"',
        );
      } else {
        activityTag = activityTag.replace(
          /(android:name="\.MainActivity")/,
          '$1\n            android:screenOrientation="sensorLandscape"',
        );
      }
    } else {
      activityTag = activityTag.replace(orientationAttrRegex, "");
    }

    manifest = manifest.replace(match[1], activityTag);
    writeFileSync(manifestPath, manifest, "utf-8");
  }

  // 2. Update build.gradle.kts
  let gradle = readFileSync(buildGradlePath, "utf-8");
  const gradleLine = `        buildConfigField("boolean", "LANDSCAPE", "${landscape}")`;
  const markerPattern = new RegExp(`(${ANDROID_ORIENTATION_START})[\\s\\S]*?(${ANDROID_ORIENTATION_END})`);

  if (markerPattern.test(gradle)) {
    gradle = gradle.replace(markerPattern, `$1\n${gradleLine}\n        $2`);
  } else {
    // If markers don't exist yet, place inside defaultConfig
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

export function injectOrientationIos(infoPlistPath: string, buildConfigPath: string, landscape: boolean): void {
  // 1. Update Info.plist
  let plist = readFileSync(infoPlistPath, "utf-8");
  const orientationsBlock = landscape ? IOS_LANDSCAPE_ORIENTATIONS : IOS_DEFAULT_ORIENTATIONS;
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
      // Fallback: inject right after <dict>
      plist = plist.replace(/(<dict>)/, `$1\n${replacement}`);
    }
  }

  writeFileSync(infoPlistPath, plist, "utf-8");

  // 2. Update BuildConfig.swift
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
