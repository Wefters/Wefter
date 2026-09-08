import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  injectOrientationAndroid,
  injectOrientationIos,
  ANDROID_ORIENTATION_START,
  ANDROID_ORIENTATION_END,
  IOS_ORIENTATION_PLIST_START,
  IOS_ORIENTATION_PLIST_END,
  IOS_ORIENTATION_CONFIG_START,
  IOS_ORIENTATION_CONFIG_END,
} from "../src/native/inject-orientation.js";

describe("injectOrientationAndroid", () => {
  let tmpDir: string;
  let manifestPath: string;
  let buildGradlePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-orientation-android-"));
    manifestPath = join(tmpDir, "AndroidManifest.xml");
    buildGradlePath = join(tmpDir, "build.gradle.kts");

    const sampleManifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <activity
            android:name=".MainActivity"
            android:theme="@style/Theme.App.Starting"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;

    const sampleGradle = `android {
    defaultConfig {
        applicationId = "dev.wefter.bridge"
        // WEFTER-SPLASH-CONFIG-START
        buildConfigField("boolean", "SPLASH_ENABLED", "false")
        // WEFTER-SPLASH-CONFIG-END

        ${ANDROID_ORIENTATION_START}
        buildConfigField("boolean", "LANDSCAPE", "false")
        ${ANDROID_ORIENTATION_END}
    }
}`;

    writeFileSync(manifestPath, sampleManifest, "utf-8");
    writeFileSync(buildGradlePath, sampleGradle, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("injects sensorLandscape into MainActivity and updates build.gradle.kts when landscape is true", () => {
    injectOrientationAndroid(manifestPath, buildGradlePath, true);

    const manifest = readFileSync(manifestPath, "utf-8");
    expect(manifest).toContain('android:screenOrientation="sensorLandscape"');

    const gradle = readFileSync(buildGradlePath, "utf-8");
    expect(gradle).toContain('buildConfigField("boolean", "LANDSCAPE", "true")');
  });

  it("removes screenOrientation and sets LANDSCAPE to false when landscape is false", () => {
    // First enable
    injectOrientationAndroid(manifestPath, buildGradlePath, true);
    expect(readFileSync(manifestPath, "utf-8")).toContain('android:screenOrientation="sensorLandscape"');

    // Then disable
    injectOrientationAndroid(manifestPath, buildGradlePath, false);
    const manifest = readFileSync(manifestPath, "utf-8");
    expect(manifest).not.toContain("android:screenOrientation");

    const gradle = readFileSync(buildGradlePath, "utf-8");
    expect(gradle).toContain('buildConfigField("boolean", "LANDSCAPE", "false")');
  });
});

describe("injectOrientationIos", () => {
  let tmpDir: string;
  let infoPlistPath: string;
  let buildConfigPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-orientation-ios-"));
    infoPlistPath = join(tmpDir, "Info.plist");
    buildConfigPath = join(tmpDir, "BuildConfig.swift");

    const samplePlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	${IOS_ORIENTATION_PLIST_START}
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	<key>UISupportedInterfaceOrientations~ipad</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationPortraitUpsideDown</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
	${IOS_ORIENTATION_PLIST_END}
</dict>
</plist>`;

    const sampleBuildConfig = `enum BuildConfig {
    ${IOS_ORIENTATION_CONFIG_START}
    static let landscape = false
    ${IOS_ORIENTATION_CONFIG_END}
}`;

    writeFileSync(infoPlistPath, samplePlist, "utf-8");
    writeFileSync(buildConfigPath, sampleBuildConfig, "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("restricts Info.plist orientations to landscape and sets BuildConfig.landscape = true", () => {
    injectOrientationIos(infoPlistPath, buildConfigPath, true);

    const plist = readFileSync(infoPlistPath, "utf-8");
    expect(plist).toContain("UIInterfaceOrientationLandscapeLeft");
    expect(plist).toContain("UIInterfaceOrientationLandscapeRight");
    expect(plist).not.toContain("UIInterfaceOrientationPortrait");

    const buildConfig = readFileSync(buildConfigPath, "utf-8");
    expect(buildConfig).toContain("static let landscape = true");
  });

  it("restores portrait orientations and sets BuildConfig.landscape = false when landscape is false", () => {
    // First set landscape
    injectOrientationIos(infoPlistPath, buildConfigPath, true);
    // Then set false
    injectOrientationIos(infoPlistPath, buildConfigPath, false);

    const plist = readFileSync(infoPlistPath, "utf-8");
    expect(plist).toContain("UIInterfaceOrientationPortrait");
    expect(plist).toContain("UIInterfaceOrientationLandscapeLeft");

    const buildConfig = readFileSync(buildConfigPath, "utf-8");
    expect(buildConfig).toContain("static let landscape = false");
  });
});
