/**
 * Applies `nativeFiles` from `wefter.config.json` and what plugins need for them: copies each environment's
 * files (such as Firebase's `google-services.json` and `GoogleService-Info.plist`) into the native
 * projects, checks the files plugins require are there, and applies the Gradle plugins plugins ask for.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { PluginManifest } from "@wefterjs/registry-codegen";
import type { WefterConfig } from "../config/wefter-config-schema.js";

const GRADLE_PLUGINS_START = "// WEFTER-GRADLE-PLUGINS-START";
const GRADLE_PLUGINS_END = "// WEFTER-GRADLE-PLUGINS-END";

/** The folder inside the iOS app's `Resources` that holds each environment's files. */
export const IOS_ENVIRONMENT_FILES_DIR = "EnvironmentFiles";

/** A plugin, as far as native files are concerned. */
export interface NativeFilesPlugin {
  manifest: Pick<PluginManifest, "name" | "requiredFiles" | "nativeDependencies">;
}

/** The files of `platform` for `env`: the environment's own list, or the top-level one. */
export function nativeFilesFor(config: WefterConfig, env: string, platform: "android" | "ios"): string[] {
  return config.environments[env]?.nativeFiles?.[platform] ?? config.nativeFiles?.[platform] ?? [];
}

/**
 * Checks every file each plugin requires is listed for every environment, and every listed file exists.
 *
 * @throws {Error} Naming the environment, the missing file and the plugin that needs it.
 */
export function checkNativeFiles(projectDir: string, config: WefterConfig, plugins: NativeFilesPlugin[]): void {
  const problems: string[] = [];
  for (const env of Object.keys(config.environments)) {
    for (const platform of ["android", "ios"] as const) {
      const files = nativeFilesFor(config, env, platform);
      for (const file of files) {
        if (!existsSync(resolve(projectDir, file))) {
          problems.push(`nativeFiles (${env}, ${platform}): ${file} does not exist`);
        }
      }
      const names = new Set(files.map((file) => basename(file)));
      for (const plugin of plugins) {
        for (const required of plugin.manifest.requiredFiles?.[platform] ?? []) {
          if (!names.has(required)) {
            problems.push(
              `Plugin "${plugin.manifest.name}" needs ${required} for ${platform}: add it to nativeFiles.${platform}` +
                ` (or environments.${env}.nativeFiles.${platform}) in wefter.config.json`,
            );
          }
        }
      }
    }
  }
  if (problems.length > 0) throw new Error(`Native files are missing:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
}

/**
 * Copies each environment's Android files into `app/src/<env>/`, where Gradle and SDK Gradle plugins read
 * flavor files. Files copied by an earlier sync and no longer listed are removed.
 */
export function copyNativeFilesAndroid(projectDir: string, config: WefterConfig, appModuleDir: string): void {
  const markerName = ".wefter-native-files";
  for (const env of Object.keys(config.environments)) {
    const dir = join(appModuleDir, "src", env);
    const marker = join(dir, markerName);
    if (existsSync(marker)) {
      for (const name of readFileSync(marker, "utf-8").split("\n").filter(Boolean))
        rmSync(join(dir, name), { force: true });
      rmSync(marker, { force: true });
    }
    const files = nativeFilesFor(config, env, "android");
    if (files.length === 0) continue;
    mkdirSync(dir, { recursive: true });
    for (const file of files) copyFileSync(resolve(projectDir, file), join(dir, basename(file)));
    writeFileSync(marker, files.map((file) => basename(file)).join("\n") + "\n");
  }
}

/**
 * Copies each environment's iOS files into `Resources/EnvironmentFiles/<env>/`, bundled as a folder, where
 * `WefterFiles.url(named:)` finds the running environment's copy.
 */
export function copyNativeFilesIos(projectDir: string, config: WefterConfig, resourcesDir: string): void {
  const root = join(resourcesDir, IOS_ENVIRONMENT_FILES_DIR);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ".keep"), "");
  for (const env of Object.keys(config.environments)) {
    const files = nativeFilesFor(config, env, "ios");
    if (files.length === 0) continue;
    const dir = join(root, env);
    mkdirSync(dir, { recursive: true });
    for (const file of files) copyFileSync(resolve(projectDir, file), join(dir, basename(file)));
  }
}

/** The Gradle plugins the plugins ask for, by id. Two plugins asking for different versions is reported. */
export function resolveGradlePlugins(plugins: NativeFilesPlugin[]): {
  plugins: { id: string; version: string }[];
  conflicts: string[];
} {
  const byId = new Map<string, { version: string; from: string }>();
  const conflicts: string[] = [];
  for (const plugin of plugins) {
    for (const gradlePlugin of plugin.manifest.nativeDependencies?.android?.gradlePlugins ?? []) {
      const existing = byId.get(gradlePlugin.id);
      if (!existing) {
        byId.set(gradlePlugin.id, { version: gradlePlugin.version, from: plugin.manifest.name });
      } else if (existing.version !== gradlePlugin.version) {
        conflicts.push(
          `${gradlePlugin.id}: "${existing.from}" asks for ${existing.version}, "${plugin.manifest.name}" for ` +
            `${gradlePlugin.version}; using ${existing.version}`,
        );
      }
    }
  }
  return { plugins: [...byId].map(([id, { version }]) => ({ id, version })), conflicts };
}

function replaceGradleBlock(path: string, lines: string[]): void {
  const current = readFileSync(path, "utf-8");
  const pattern = new RegExp(`( *)${GRADLE_PLUGINS_START}[\\s\\S]*?${GRADLE_PLUGINS_END}`);
  const match = pattern.exec(current);
  if (!match) throw new Error(`No ${GRADLE_PLUGINS_START} marker found in ${path}`);
  const indent = match[1];
  const body = lines.map((line) => `${indent}${line}\n`).join("");
  writeFileSync(
    path,
    current.replace(pattern, () => `${indent}${GRADLE_PLUGINS_START}\n${body}${indent}${GRADLE_PLUGINS_END}`),
  );
}

/** Declares the Gradle plugins in the root build file and applies them to the app module. */
export function injectGradlePlugins(
  rootBuildGradlePath: string,
  appBuildGradlePath: string,
  gradlePlugins: { id: string; version: string }[],
): void {
  replaceGradleBlock(
    rootBuildGradlePath,
    gradlePlugins.map((p) => `id(${JSON.stringify(p.id)}) version ${JSON.stringify(p.version)} apply false`),
  );
  replaceGradleBlock(
    appBuildGradlePath,
    gradlePlugins.map((p) => `id(${JSON.stringify(p.id)})`),
  );
}
