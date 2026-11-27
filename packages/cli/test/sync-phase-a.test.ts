import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { sync } from "../src/commands/sync.js";
import { WefterConfigSchema } from "../src/config/wefter-config-schema.js";
import { androidQualifier } from "../src/native/inject-localization.js";

const fixtureTestProjectDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/test-project");

let projectDir: string;
let androidApp: string;
let iosApp: string;

/** Applies `change` to the project's wefter.config.json. */
function editConfig(change: (config: Record<string, unknown>) => void) {
  const path = join(projectDir, "wefter.config.json");
  const config = JSON.parse(readFileSync(path, "utf-8"));
  change(config);
  writeFileSync(path, JSON.stringify(config, null, 2));
}

/** Adds to the ping-test plugin's plugin.json. */
function editPluginManifest(change: (manifest: Record<string, unknown>) => void) {
  const path = join(projectDir, "plugins/ping-test/plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf-8"));
  change(manifest);
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-sync-a-"));
  cpSync(join(fixtureTestProjectDir, "plugins"), join(projectDir, "plugins"), { recursive: true });
  cpSync(join(fixtureTestProjectDir, "wefter.config.json"), join(projectDir, "wefter.config.json"));
  cpSync(join(fixtureTestProjectDir, "web"), join(projectDir, "web"), { recursive: true });
  androidApp = join(projectDir, ".wefter/native/android/app");
  iosApp = join(projectDir, ".wefter/native/ios/WefterBridge");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("frames", () => {
  it("adds allowed and granted sites to frame-src and writes the grants on both platforms", async () => {
    editConfig((config) => {
      config.frames = {
        allow: ["https://*.partner.example"],
        plugins: { "https://pay.example.com": ["ping-test.ping", "nope.*"] },
      };
    });

    const result = await sync(projectDir);

    const gradle = read(join(androidApp, "build.gradle.kts"));
    expect(gradle).toContain(
      'buildConfigField("String", "FRAME_SOURCES", "\\"https://*.partner.example https://pay.example.com\\"")',
    );
    expect(gradle).toContain(
      'buildConfigField("String", "FRAME_PLUGIN_GRANTS", "\\"{\\\\\\"https://pay.example.com\\\\\\":[\\\\\\"ping-test.ping\\\\\\",\\\\\\"nope.*\\\\\\"]}\\"")',
    );
    const buildConfig = read(join(iosApp, "BuildConfig.swift"));
    expect(buildConfig).toContain('static let frameSources = "https://*.partner.example https://pay.example.com"');
    expect(buildConfig).toContain(
      'static let framePluginGrants: [String: [String]] = ["https://pay.example.com": ["ping-test.ping", "nope.*"]]',
    );
    expect(result.warnings).toContain(
      'frames.plugins grants https://pay.example.com "nope.*", but the app has no "nope" plugin',
    );
  });

  it("leaves both platforms with only the app's own frames when frames is not set", async () => {
    await sync(projectDir);

    expect(read(join(androidApp, "build.gradle.kts"))).toContain(
      'buildConfigField("String", "FRAME_SOURCES", "\\"\\"")',
    );
    expect(read(join(iosApp, "BuildConfig.swift"))).toContain("static let framePluginGrants: [String: [String]] = [:]");
  });

  it("refuses wildcards in plugin grants and origins with paths", () => {
    const environments = { production: { appId: "com.example.app", appName: "Example" } };
    expect(
      WefterConfigSchema.safeParse({ environments, frames: { plugins: { "https://*.example.com": ["a.b"] } } }).success,
    ).toBe(false);
    expect(WefterConfigSchema.safeParse({ environments, frames: { allow: ["https://example.com/pay"] } }).success).toBe(
      false,
    );
    expect(WefterConfigSchema.safeParse({ environments, frames: { allow: ["http://example.com"] } }).success).toBe(
      false,
    );
    expect(WefterConfigSchema.safeParse({ environments, frames: { allow: ["http://localhost:5173"] } }).success).toBe(
      true,
    );
  });
});

describe("localization", () => {
  beforeEach(() => {
    const i18n = join(projectDir, "plugins/ping-test/i18n");
    mkdirSync(i18n, { recursive: true });
    writeFileSync(join(i18n, "en.json"), JSON.stringify({ "ping-test.title": "Ping", "ping-test.done": "Done" }));
    writeFileSync(join(i18n, "fr.json"), JSON.stringify({ "ping-test.title": "Ping (fr)" }));
    editConfig((config) => {
      config.localization = {
        languages: ["fr", "pt-BR"],
        messages: {
          fr: {
            "links.noApp": "Aucune application ne peut ouvrir ce lien",
            "app.name": "Exemple d'app",
            "permissions.camera": "Prendre une photo du reçu.",
            "typo.key": "?",
          },
        },
      };
    });
  });

  it("merges shell, plugin and app text for the app's languages, app text last", async () => {
    const result = await sync(projectDir);

    expect(result.languages).toEqual(["en", "fr", "pt-BR"]);
    for (const file of [
      join(androidApp, "src/main/assets/wefter-messages.json"),
      join(iosApp, "Resources/WefterMessages.json"),
    ]) {
      const messages = JSON.parse(read(file));
      expect(Object.keys(messages)).toEqual(["en", "fr", "pt-BR"]);
      expect(messages.en["links.noApp"]).toBe("No app can open this link");
      expect(messages.en["ping-test.title"]).toBe("Ping");
      expect(messages.fr["links.noApp"]).toBe("Aucune application ne peut ouvrir ce lien");
      expect(messages.fr["ping-test.title"]).toBe("Ping (fr)");
      expect(messages.fr["app.name"]).toBeUndefined();
    }
    expect(result.warnings).toContain('localization.messages.fr has "typo.key", which no shell or plugin text uses');
    expect(result.warnings.some((w) => /no "pt-BR" translation/.test(w))).toBe(true);
  });

  it("declares the languages and writes the translated app name on Android", async () => {
    await sync(projectDir);

    const localesConfig = read(join(androidApp, "src/main/res/xml/locales_config.xml"));
    expect(localesConfig).toContain('<locale android:name="en" />');
    expect(localesConfig).toContain('<locale android:name="pt-BR" />');
    expect(read(join(androidApp, "src/main/AndroidManifest.xml"))).toContain(
      'android:localeConfig="@xml/locales_config"',
    );
    expect(read(join(androidApp, "src/main/res/values-fr/wefter_localized.xml"))).toContain(
      '<string name="app_name">Exemple d\\\'app</string>',
    );
  });

  it("declares the languages and writes the translated name and permission messages on iOS", async () => {
    await sync(projectDir);

    const plist = read(join(iosApp, "Info.plist"));
    expect(plist).toMatch(/<key>CFBundleLocalizations<\/key>\s*<array>\s*<string>en<\/string>\s*<string>fr<\/string>/);
    const strings = read(join(iosApp, "Resources/fr.lproj/InfoPlist.strings"));
    expect(strings).toContain('"CFBundleDisplayName" = "Exemple d\'app";');
    expect(strings).toContain('"NSCameraUsageDescription" = "Prendre une photo du reçu.";');
    expect(existsSync(join(iosApp, "Resources/pt-BR.lproj"))).toBe(false);
  });

  it("maps language tags to Android resource qualifiers", () => {
    expect(androidQualifier("fr")).toBe("fr");
    expect(androidQualifier("pt-BR")).toBe("pt-rBR");
    expect(androidQualifier("zh-Hans")).toBe("b+zh+Hans");
  });
});

describe("native files", () => {
  beforeEach(() => {
    mkdirSync(join(projectDir, "firebase/prod"), { recursive: true });
    writeFileSync(join(projectDir, "firebase/google-services.json"), '{"env":"dev"}');
    writeFileSync(join(projectDir, "firebase/GoogleService-Info.plist"), "<plist>dev</plist>");
    writeFileSync(join(projectDir, "firebase/prod/google-services.json"), '{"env":"prod"}');
  });

  it("copies each environment's files, the environment's own list winning", async () => {
    editConfig((config) => {
      config.nativeFiles = { android: ["firebase/google-services.json"], ios: ["firebase/GoogleService-Info.plist"] };
      (config.environments as Record<string, Record<string, unknown>>).production.nativeFiles = {
        android: ["firebase/prod/google-services.json"],
      };
    });

    await sync(projectDir);

    expect(read(join(androidApp, "src/development/google-services.json"))).toBe('{"env":"dev"}');
    expect(read(join(androidApp, "src/production/google-services.json"))).toBe('{"env":"prod"}');
    expect(read(join(iosApp, "Resources/EnvironmentFiles/development/GoogleService-Info.plist"))).toBe(
      "<plist>dev</plist>",
    );
    expect(read(join(iosApp, "Resources/EnvironmentFiles/production/GoogleService-Info.plist"))).toBe(
      "<plist>dev</plist>",
    );
  });

  it("fails naming the plugin, platform and environment when a required file is missing", async () => {
    editPluginManifest((manifest) => {
      manifest.requiredFiles = { android: ["google-services.json"], ios: [] };
    });
    editConfig((config) => {
      (config.environments as Record<string, Record<string, unknown>>).development.nativeFiles = {
        android: ["firebase/google-services.json"],
      };
    });

    await expect(sync(projectDir)).rejects.toThrow(
      /Plugin "ping-test" needs google-services.json for android: .*environments\.production\.nativeFiles\.android/,
    );
  });

  it("fails when a listed file does not exist", async () => {
    editConfig((config) => {
      config.nativeFiles = { android: ["firebase/missing.json"] };
    });

    await expect(sync(projectDir)).rejects.toThrow(/firebase\/missing.json does not exist/);
  });

  it("declares and applies the Gradle plugins plugins ask for", async () => {
    editPluginManifest((manifest) => {
      const deps = (manifest.nativeDependencies ?? {}) as Record<string, Record<string, unknown>>;
      deps.android = {
        ...(deps.android ?? {}),
        gradlePlugins: [{ id: "com.google.gms.google-services", version: "4.4.2" }],
      };
      manifest.nativeDependencies = deps;
    });

    await sync(projectDir);

    expect(read(join(androidApp, "../build.gradle.kts"))).toContain(
      'id("com.google.gms.google-services") version "4.4.2" apply false',
    );
    expect(read(join(androidApp, "build.gradle.kts"))).toMatch(
      /plugins \{[\s\S]*id\("com.google.gms.google-services"\)/,
    );
  });
});

describe("iOS environment name", () => {
  it("writes each environment's name into its build settings", async () => {
    await sync(projectDir);

    const config = read(join(projectDir, ".wefter/native/ios/Config/Environment-production.xcconfig"));
    expect(config).toContain("WEFTER_ENVIRONMENT = production");
    expect(read(join(iosApp, "Info.plist"))).toContain("<key>WefterEnvironment</key>");
  });
});
