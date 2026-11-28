import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROFILE_DEFAULTS,
  describeSystemUI,
  injectSystemUIAndroid,
  injectSystemUIIos,
  resolveSystemUI,
} from "../src/native/inject-system-ui.js";
import { WefterConfigSchema } from "../src/config/wefter-config-schema.js";

const shells = join(dirname(fileURLToPath(import.meta.url)), "../../../shells");
const templateGradle = join(shells, "android-template/app/build.gradle.kts");
const templateManifest = join(shells, "android-template/app/src/main/AndroidManifest.xml");
const templateBuildConfig = join(shells, "ios-template/WefterBridge/BuildConfig.swift");
const templatePlist = join(shells, "ios-template/WefterBridge/Info.plist");

function parse(extra: Record<string, unknown>) {
  return WefterConfigSchema.parse({ environments: { development: { appId: "a.b", appName: "A" } }, ...extra });
}

describe("resolveSystemUI", () => {
  it("keeps an ordinary app's behaviour by default", () => {
    expect(resolveSystemUI(parse({}))).toEqual({ profile: "app", ...PROFILE_DEFAULTS.app });
    expect(describeSystemUI(resolveSystemUI(parse({})))).toBeNull();
  });

  it("applies the game profile, and settings replace its defaults", () => {
    const resolved = resolveSystemUI(
      parse({ profile: "game", gestures: { zoom: true }, systemBars: { icons: "light" }, audio: { autoplay: false } }),
    );
    expect(resolved).toMatchObject({
      profile: "game",
      barsHidden: true,
      icons: "light",
      swipeBack: false,
      zoom: true,
      longPress: false,
      overscroll: false,
      edgeProtection: true,
      autoplay: false,
      followSystemTextSize: false,
    });
    expect(describeSystemUI(resolved)).toBe(
      "game profile: bars hidden, light bar icons, no swipe back, no long press, no overscroll, protected edges, fixed text size",
    );
  });

  it("accepts areas for edge protection and refuses unknown values", () => {
    const area = { x: 0, y: 100, width: 120, height: 120 };
    expect(resolveSystemUI(parse({ gestures: { edgeProtection: [area], swipeBack: "page" } }))).toMatchObject({
      edgeProtection: [area],
      swipeBack: "page",
    });
    expect(() => parse({ profile: "arcade" })).toThrow();
    expect(() => parse({ gestures: { swipeBack: true } })).toThrow();
    expect(() => parse({ gestures: { edgeProtection: [{ x: 0, y: 0, width: 0, height: 10 }] } })).toThrow();
    expect(() => parse({ audio: { silentSwitch: "loud" } })).toThrow();
  });
});

describe("system UI injection", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wefter-system-ui-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("has empty settings in the templates, which the shells read as an ordinary app", () => {
    expect(readFileSync(templateGradle, "utf-8")).toContain('buildConfigField("String", "SYSTEM_UI", "\\"\\"")');
    expect(readFileSync(templateBuildConfig, "utf-8")).toContain('static let systemUI = ""');
  });

  it("writes the settings as JSON both shells read, and replaces them on the next sync", () => {
    const gradle = join(dir, "build.gradle.kts");
    const manifest = join(dir, "AndroidManifest.xml");
    const buildConfig = join(dir, "BuildConfig.swift");
    const plist = join(dir, "Info.plist");
    copyFileSync(templateGradle, gradle);
    copyFileSync(templateManifest, manifest);
    copyFileSync(templateBuildConfig, buildConfig);
    copyFileSync(templatePlist, plist);

    const game = resolveSystemUI(parse({ profile: "game" }));
    injectSystemUIAndroid(gradle, game, manifest);
    injectSystemUIIos(buildConfig, plist, game);
    injectSystemUIAndroid(gradle, game, manifest);
    injectSystemUIIos(buildConfig, plist, game);

    const manifestGame = readFileSync(manifest, "utf-8");
    expect(manifestGame.match(/android:appCategory="game"/g)).toHaveLength(1);
    expect(manifestGame.match(/android:isGame="true"/g)).toHaveLength(1);

    const gradleText = readFileSync(gradle, "utf-8");
    const field = gradleText.match(/buildConfigField\("String", "SYSTEM_UI", (".*")\)/)![1];
    // The field is a Kotlin string holding Java source: a string literal holding the JSON.
    const settings = JSON.parse(JSON.parse(JSON.parse(field)));
    expect(settings).toEqual(PROFILE_DEFAULTS.game);
    expect(gradleText.match(/SYSTEM_UI/g)).toHaveLength(1);

    const swift = readFileSync(buildConfig, "utf-8");
    const literal = swift.match(/static let systemUI = (".*")/)![1];
    expect(JSON.parse(JSON.parse(literal))).toEqual(PROFILE_DEFAULTS.game);
    expect(readFileSync(plist, "utf-8").match(/<key>UIStatusBarHidden<\/key>/g)).toHaveLength(1);

    const app = resolveSystemUI(parse({}));
    injectSystemUIAndroid(gradle, app, manifest);
    injectSystemUIIos(buildConfig, plist, app);
    expect(readFileSync(manifest, "utf-8")).not.toContain('android:appCategory="game"');
    expect(readFileSync(manifest, "utf-8")).not.toContain('android:isGame="true"');
    expect(readFileSync(plist, "utf-8")).not.toContain("<key>UIStatusBarHidden</key>");
  });

  it("adds the blocks to projects that predate the markers", () => {
    const gradle = join(dir, "build.gradle.kts");
    const buildConfig = join(dir, "BuildConfig.swift");
    const plist = join(dir, "Info.plist");
    writeFileSync(gradle, "android {\n    defaultConfig {\n        minSdk = 24\n    }\n}\n");
    writeFileSync(buildConfig, "enum BuildConfig {\n    static let landscape = false\n}\n");
    writeFileSync(plist, "<plist>\n<dict>\n\t<key>A</key>\n\t<string>b</string>\n</dict>\n</plist>\n");

    const game = resolveSystemUI(parse({ profile: "game" }));
    injectSystemUIAndroid(gradle, game);
    injectSystemUIIos(buildConfig, plist, game);

    expect(readFileSync(gradle, "utf-8")).toMatch(/defaultConfig \{\n\s+\/\/ WEFTER-SYSTEM-UI-CONFIG-START/);
    expect(readFileSync(buildConfig, "utf-8")).toMatch(
      /static let systemUI = ".*"\n\s+\/\/ WEFTER-SYSTEM-UI-CONFIG-END\n\}/,
    );
    expect(readFileSync(plist, "utf-8")).toContain(
      "<key>UIStatusBarHidden</key>\n\t<true/>\n\t<!-- WEFTER-SYSTEM-UI-END -->\n</dict>",
    );
  });
});
