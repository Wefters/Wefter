/**
 * Applies `localization` from `wefter.config.json`: merges the shells', plugins' and app's text for the
 * app's languages into the file the shells read at runtime, declares the languages to iOS and Android, and
 * writes the translated app name and permission messages.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LocalizationConfig } from "../config/wefter-config-schema.js";

/** Keys that translate native settings rather than runtime text. */
const INFO_PLIST_KEYS: Record<string, string[]> = {
  "app.name": ["CFBundleDisplayName", "CFBundleName"],
  "permissions.camera": ["NSCameraUsageDescription"],
  "permissions.microphone": ["NSMicrophoneUsageDescription"],
  "permissions.location": ["NSLocationWhenInUseUsageDescription"],
};

const IOS_LOCALIZATIONS_START = "<!-- WEFTER-LOCALIZATIONS-START -->";
const IOS_LOCALIZATIONS_END = "<!-- WEFTER-LOCALIZATIONS-END -->";
const ANDROID_STRINGS_FILE = "wefter_localized.xml";

/** Text by language, then key. */
export type Messages = Record<string, Record<string, string>>;

/** The merged text, and what sync should warn about. */
export interface ResolvedMessages {
  /** The app's languages, English first. */
  languages: string[];
  /** Runtime text the shells and plugins look up, by language. */
  runtime: Messages;
  /** App name and permission messages, by language (keys as in {@link INFO_PLIST_KEYS} or `infoPlist.*`). */
  native: Messages;
  warnings: string[];
}

/** A plugin's directory and name, whose `i18n/` folder may hold its text. */
export interface PluginMessagesSource {
  name: string;
  dir: string;
}

function isNativeKey(key: string): boolean {
  return key in INFO_PLIST_KEYS || key.startsWith("infoPlist.");
}

/** Reads `<dir>/<language>.json` files. */
function readLanguageFiles(dir: string, label: string, warnings: string[]): Messages {
  const result: Messages = {};
  if (!existsSync(dir)) return result;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const language = file.slice(0, -".json".length);
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf-8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      result[language] = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
    } catch (error) {
      warnings.push(`${label}/${file} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

/** `source[language]`, or the text of its base language (`pt` for `pt-BR`). */
function forLanguage(source: Messages, language: string): Record<string, string> {
  return source[language] ?? source[language.split("-")[0]] ?? {};
}

/**
 * Merges the shells' text (`shellDir/<language>.json`), each plugin's (`<plugin>/i18n/<language>.json`,
 * keys prefixed with the plugin's name) and the app's `localization.messages`, in that order, for English
 * and the app's languages.
 */
export function resolveMessages(
  shellDir: string,
  plugins: PluginMessagesSource[],
  localization: LocalizationConfig | undefined,
): ResolvedMessages {
  const warnings: string[] = [];
  const languages = [...new Set(["en", ...(localization?.languages ?? [])])];
  const shell = readLanguageFiles(shellDir, "shell i18n", warnings);
  const pluginSources = plugins.map((plugin) => {
    const messages = readLanguageFiles(join(plugin.dir, "i18n"), `${plugin.name} i18n`, warnings);
    for (const key of Object.keys(messages.en ?? {})) {
      if (!key.startsWith(`${plugin.name}.`)) {
        warnings.push(`Plugin "${plugin.name}" has the text key "${key}", which should start with "${plugin.name}."`);
      }
    }
    return messages;
  });
  const app = localization?.messages ?? {};

  const known = new Set([...Object.keys(shell.en ?? {}), ...pluginSources.flatMap((p) => Object.keys(p.en ?? {}))]);
  for (const [language, texts] of Object.entries(app)) {
    if (!languages.includes(language)) {
      warnings.push(`localization.messages has "${language}", which isn't in localization.languages; it is left out`);
    }
    for (const key of Object.keys(texts)) {
      if (!known.has(key) && !isNativeKey(key)) {
        warnings.push(`localization.messages.${language} has "${key}", which no shell or plugin text uses`);
      }
    }
  }

  const runtime: Messages = {};
  const native: Messages = {};
  for (const language of languages) {
    const merged: Record<string, string> = {
      ...forLanguage(shell, language),
      ...Object.assign({}, ...pluginSources.map((p) => forLanguage(p, language))),
      ...(app[language] ?? {}),
    };
    runtime[language] = Object.fromEntries(Object.entries(merged).filter(([key]) => !isNativeKey(key)));
    native[language] = Object.fromEntries(Object.entries(merged).filter(([key]) => isNativeKey(key)));
    if (language !== "en") {
      const missing = [...known].filter((key) => !(key in runtime[language])).length;
      if (missing > 0) {
        warnings.push(
          `${missing} text${missing === 1 ? " has" : "s have"} no "${language}" translation and show in English`,
        );
      }
    }
  }
  return { languages, runtime, native, warnings };
}

/** Writes the runtime text the Android shell reads (`assets/wefter-messages.json`). */
export function writeMessagesAndroid(assetsDir: string, messages: ResolvedMessages): void {
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(assetsDir, "wefter-messages.json"), JSON.stringify(messages.runtime, null, 2) + "\n");
}

/** Writes the runtime text the iOS shell reads (`Resources/WefterMessages.json`). */
export function writeMessagesIos(resourcesDir: string, messages: ResolvedMessages): void {
  mkdirSync(resourcesDir, { recursive: true });
  writeFileSync(join(resourcesDir, "WefterMessages.json"), JSON.stringify(messages.runtime, null, 2) + "\n");
}

/** The Android resource folder qualifier for a language tag: `fr`, `pt-rBR`, `b+zh+Hans`. */
export function androidQualifier(language: string): string {
  if (/^[a-z]{2,3}$/.test(language)) return language;
  const regional = /^([a-z]{2,3})-([A-Z]{2})$/.exec(language);
  if (regional) return `${regional[1]}-r${regional[2]}`;
  return `b+${language.replace(/-/g, "+")}`;
}

function escapeAndroidString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/^([@?])/, "\\$1");
}

/**
 * Declares the app's languages to Android 13+ (`res/xml/locales_config.xml`, so the system's per-app
 * language setting lists them) and writes translated app names (`res/values-<language>/`).
 */
export function injectLocalizationAndroid(resDir: string, manifestPath: string, messages: ResolvedMessages): void {
  if (existsSync(resDir)) {
    for (const entry of readdirSync(resDir)) {
      if (entry.startsWith("values-")) rmSync(join(resDir, entry, ANDROID_STRINGS_FILE), { force: true });
    }
  }

  mkdirSync(join(resDir, "xml"), { recursive: true });
  const locales = messages.languages.map((language) => `    <locale android:name="${language}" />`).join("\n");
  writeFileSync(
    join(resDir, "xml", "locales_config.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<!-- Written by wefter sync from localization.languages. -->\n` +
      `<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n${locales}\n</locale-config>\n`,
  );

  let manifest = readFileSync(manifestPath, "utf-8");
  if (!manifest.includes("android:localeConfig=")) {
    manifest = manifest.replace(/<application\b/, '<application\n        android:localeConfig="@xml/locales_config"');
    writeFileSync(manifestPath, manifest);
  }

  for (const language of messages.languages) {
    const name = messages.native[language]?.["app.name"];
    if (!name || language === "en") continue;
    const dir = join(resDir, `values-${androidQualifier(language)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ANDROID_STRINGS_FILE),
      `<?xml version="1.0" encoding="utf-8"?>\n<!-- Written by wefter sync from localization.messages. -->\n<resources>\n` +
        `    <string name="app_name">${escapeAndroidString(name)}</string>\n</resources>\n`,
    );
  }
}

function escapeStringsValue(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Declares the app's languages to iOS (`CFBundleLocalizations` in `Info.plist`), so its own sheets and
 * buttons follow the user's language, and writes translated app names and permission messages
 * (`Resources/<language>.lproj/InfoPlist.strings`).
 */
export function injectLocalizationIos(infoPlistPath: string, resourcesDir: string, messages: ResolvedMessages): void {
  let plist = readFileSync(infoPlistPath, "utf-8");
  const block =
    `${IOS_LOCALIZATIONS_START}\n\t<key>CFBundleLocalizations</key>\n\t<array>\n` +
    messages.languages.map((language) => `\t\t<string>${language}</string>`).join("\n") +
    `\n\t</array>\n\t${IOS_LOCALIZATIONS_END}`;
  const pattern = new RegExp(`${IOS_LOCALIZATIONS_START}[\\s\\S]*?${IOS_LOCALIZATIONS_END}`);
  if (pattern.test(plist)) {
    plist = plist.replace(pattern, () => block);
  } else {
    plist = plist.replace(
      /(<key>CFBundleDevelopmentRegion<\/key>\s*<string>[^<]*<\/string>)/,
      (match) => `${match}\n\t${block}`,
    );
  }
  writeFileSync(infoPlistPath, plist);

  if (existsSync(resourcesDir)) {
    for (const entry of readdirSync(resourcesDir)) {
      if (entry.endsWith(".lproj")) rmSync(join(resourcesDir, entry), { recursive: true, force: true });
    }
  }
  for (const language of messages.languages) {
    const lines: string[] = [];
    for (const [key, text] of Object.entries(messages.native[language] ?? {})) {
      const plistKeys = INFO_PLIST_KEYS[key] ?? [key.slice("infoPlist.".length)];
      for (const plistKey of plistKeys) lines.push(`"${plistKey}" = "${escapeStringsValue(text)}";`);
    }
    if (lines.length === 0) continue;
    const dir = join(resourcesDir, `${language}.lproj`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "InfoPlist.strings"),
      `/* Written by wefter sync from localization.messages. */\n${lines.join("\n")}\n`,
    );
  }
}
