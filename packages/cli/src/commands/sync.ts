/**
 * `wefter sync`: regenerates the native projects from `wefter.config.json`, the installed plugins and the
 * built web app. Run it after changing the config, adding or updating a plugin, or rebuilding the web app.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  auditPluginPermissions,
  computeGradleMerge,
  copyAndroidNativeSource,
  copyIosNativeSource,
  copyWebAssets,
  generateNativeDependenciesPackage,
  generateRegistryKotlin,
  generateRegistrySwift,
  injectEnvironmentConfig,
  injectSplashConfig,
  mergeGradleDeps,
  mergeInfoPlist,
  mergeManifestEntries,
  mergePermissions,
  mergeProguardRules,
  validatePluginDirectory,
  type MergedManifestEntry,
  type PluginExtraction,
  type PluginExtractionSwift,
} from "@wefterjs/registry-codegen";
import {
  androidAppModuleDir,
  androidBuildGradlePath,
  androidColorsPath,
  androidGeneratedRegistryPath,
  androidManifestPath,
  androidNamespace,
  androidPluginSourceDir,
  androidProguardRulesPath,
  androidProjectRootDir,
  androidResDir,
  androidWebAssetsDir,
  iosAppDir,
  iosBuildConfigPath,
  iosBundleId,
  iosGeneratedRegistryPath,
  iosInfoPlistPath,
  iosLaunchScreenStoryboardPath,
  iosNativeDependenciesPackagePath,
  iosPluginSourceDir,
  iosProjectRootDir,
  iosWebAssetsDir,
  iosXcconfigPath,
  iosConfigDir,
  isEjected,
  loadWefterConfig,
  pluginsDirPath,
} from "../config/project-paths.js";
import { runTransactionalSync } from "../utils/transactional-sync.js";
import { resetDevServerUrl } from "../native/inject-dev-server.js";
import { resetDevServerUrlIos, resetNetworkSecurityExceptionsIos } from "../native/inject-dev-server-ios.js";
import { injectNamespace, weaveAndroidNamespace } from "../native/namespace.js";
import { injectEnvironmentConfigIos } from "../native/inject-environment-ios.js";
import { injectSplashConfigIos } from "../native/inject-splash-config-ios.js";
import { generateAndroidIcons } from "../native/icon-generator.js";
import { generateIosIcons } from "../native/icon-generator-ios.js";
import { generateSplash } from "../native/splash-generator.js";
import { resolveSplash, SPLASH_DEFAULTS } from "../native/resolve-splash.js";
import { resolveLaunchBackground } from "../native/resolve-launch-background.js";
import { injectLaunchBackgroundAndroid } from "../native/inject-launch-background.js";
import { injectLaunchBackgroundIos } from "../native/inject-launch-background-ios.js";
import { injectOrientationAndroid, injectOrientationIos } from "../native/inject-orientation.js";
import {
  androidFlavorManifestPath,
  injectDeepLinksAndroid,
  injectDeepLinksIos,
  iosEntitlementsPath,
} from "../native/inject-deep-links.js";
import { resolveDeepLinks, type ResolvedDeepLinks } from "../config/deep-links.js";
import { shellTemplatePath, iosShellTemplatePath } from "../native/shell-template.js";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../plugins/registry.js";
import { checkLockDrift, writeLockfile } from "../plugins/lockfile.js";
import { writeSyncMarker } from "../plugins/sync-freshness.js";
import { runHook } from "../hooks/run-hook.js";

/** Everything a sync added or changed, for the summary. */
export interface SyncResult {
  plugins: string[];
  unresolvedRegisteredPlugins: string[];
  outFile: string;
  pluginSourceDir: string;
  gradleDepsAdded: string[];
  gradleConflicts: string[];
  permissionsAdded: string[];
  manifestEntriesAdded: MergedManifestEntry[];
  proguardRulesAdded: string[];
  webAssetsDir: string;
  environments: string[];
  deepLinks: Record<string, ResolvedDeepLinks>;

  iosOutFile: string;
  iosPluginSourceDir: string;
  iosPluginsWithNativeSource: string[];
  iosPermissionsAdded: Record<string, string>;
  iosWebAssetsDir: string;
}

/** Build caches kept when the native project is regenerated, so rebuilds stay incremental. */
const PRESERVED_DIR_NAMES = new Set(["build", ".gradle"]);

/** Empties `dir`, keeping build cache folders. */
function removePreservingBuildDirs(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && PRESERVED_DIR_NAMES.has(entry.name)) continue;
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      removePreservingBuildDirs(entryPath);
      if (readdirSync(entryPath).length === 0) {
        rmSync(entryPath, { recursive: true, force: true });
      }
    } else {
      rmSync(entryPath, { force: true });
    }
  }
}

/** Replaces the generated Android project with a fresh copy of the template. */
function recreateNativeShell(projectDir: string): void {
  const root = androidProjectRootDir(projectDir);
  removePreservingBuildDirs(root);
  cpSync(shellTemplatePath(), root, {
    recursive: true,
    filter: (src) => !/[\\/](build|\.gradle)([\\/]|$)/.test(src),
  });
}

/** Replaces the generated iOS project with a fresh copy of the template. */
function recreateIosNativeShell(projectDir: string): void {
  const root = iosProjectRootDir(projectDir);
  removePreservingBuildDirs(root);
  cpSync(iosShellTemplatePath(), root, {
    recursive: true,
    filter: (src) => !/[\\/]build([\\/]|$)/.test(src),
  });
}

/**
 * Options for {@link sync}.
 *
 * - `requireWebAssets`: fail when the web app has not been built (default `true`).
 * - `updateLock`: accept plugin version changes and update the lockfile.
 */
export interface SyncOptions {
  requireWebAssets?: boolean;
  updateLock?: boolean;
}

/**
 * Syncs the native projects.
 *
 * 1. Loads and validates the declared plugins and checks them against the lockfile.
 * 2. Regenerates both native projects from the templates (ejected projects are updated in place).
 * 3. Copies the web app, plugin sources and splash screen in, and resets dev server settings.
 * 4. Merges plugin dependencies, permissions, components and ProGuard rules.
 * 5. Applies environments, icons, splash, launch background, orientation and deep link schemes.
 * 6. Generates the plugin registries and writes the lockfile and sync marker.
 *
 * The `wefter:sync` hooks run before and after. In an ejected project the changed files are restored if
 * anything fails.
 *
 * @throws {Error} When a plugin is invalid or missing a permission, plugin versions drifted, or the web app
 * has not been built.
 */
export async function sync(projectDir: string, options: SyncOptions = {}): Promise<SyncResult> {
  await runHook(projectDir, "sync", "before");

  const requireWebAssets = options.requireWebAssets ?? true;
  const config = loadWefterConfig(projectDir);
  const ejected = isEjected(projectDir);
  const namespace = androidNamespace(config);

  const outFile = androidGeneratedRegistryPath(projectDir, config);
  const pluginSourceDir = androidPluginSourceDir(projectDir, config);
  const buildGradlePath = androidBuildGradlePath(projectDir);
  const manifestPath = androidManifestPath(projectDir);
  const webAssetsDir = androidWebAssetsDir(projectDir);
  const proguardRulesPath = androidProguardRulesPath(projectDir);
  const resDir = androidResDir(projectDir);

  const iosOutFile = iosGeneratedRegistryPath(projectDir);
  const iosPluginSourceDirPath = iosPluginSourceDir(projectDir);
  const iosBuildConfigPathVar = iosBuildConfigPath(projectDir);
  const iosInfoPlistPathVar = iosInfoPlistPath(projectDir);
  const iosWebAssetsDirPath = iosWebAssetsDir(projectDir);
  const iosNativeDependenciesPackagePathVar = iosNativeDependenciesPackagePath(projectDir);
  const iosAppIconSetDir = join(iosAppDir(projectDir), "Assets.xcassets/AppIcon.appiconset");

  /** The sync itself; wrapped in a transaction for ejected projects. */
  const doSync = async (): Promise<SyncResult> => {
    const pluginsDir = pluginsDirPath(projectDir, config);

    const plugins = resolveRegisteredPlugins(pluginsDir, config.plugins);
    const unresolved = unresolvedRegisteredPlugins(pluginsDir, config.plugins);

    const permissionViolations = auditPluginPermissions(plugins);
    if (permissionViolations.length > 0) {
      throw new Error(`Plugin permission audit failed:\n${permissionViolations.map((v) => `  - ${v}`).join("\n")}`);
    }

    const drift = checkLockDrift(projectDir, plugins);
    if (drift.length > 0 && !options.updateLock) {
      throw new Error(
        `Plugin version drift detected against wefter.lock.json:\n${drift.map((d) => `  - ${d}`).join("\n")}\n` +
          `Run \`wefter sync --update-lock\` if this is expected.`,
      );
    }

    const extraction = new Map<string, PluginExtraction>();
    const iosExtraction = new Map<string, PluginExtractionSwift>();
    for (const plugin of plugins) {
      const validation = validatePluginDirectory(plugin.packageDir);
      if (!validation.valid) {
        throw new Error(`Plugin "${plugin.manifest.name}":\n${validation.issues.map((i) => `  - ${i}`).join("\n")}`);
      }
      if (validation.extraction) extraction.set(plugin.manifest.name, validation.extraction);
      if (validation.iosExtraction) iosExtraction.set(plugin.manifest.name, validation.iosExtraction);
    }

    const androidPlugins = plugins.filter((p) => existsSync(join(p.packageDir, "android")));
    const iosPlugins = plugins.filter((p) => existsSync(join(p.packageDir, "ios")));

    if (!ejected) {
      recreateNativeShell(projectDir);
      injectNamespace(buildGradlePath, namespace);
      weaveAndroidNamespace(androidAppModuleDir(projectDir), namespace);

      recreateIosNativeShell(projectDir);
    }

    if (requireWebAssets || existsSync(join(projectDir, config.webDir))) {
      copyWebAssets(projectDir, config.webDir, webAssetsDir);
      copyWebAssets(projectDir, config.webDir, iosWebAssetsDirPath);
    } else {
      rmSync(webAssetsDir, { recursive: true, force: true });
      mkdirSync(webAssetsDir, { recursive: true });
      rmSync(iosWebAssetsDirPath, { recursive: true, force: true });
      mkdirSync(iosWebAssetsDirPath, { recursive: true });
    }
    resetDevServerUrl(buildGradlePath);
    resetDevServerUrlIos(iosBuildConfigPathVar);
    resetNetworkSecurityExceptionsIos(iosInfoPlistPathVar);

    copyAndroidNativeSource(androidPlugins, pluginSourceDir, namespace);
    const iosPluginsWithNativeSource = copyIosNativeSource(iosPlugins, iosPluginSourceDirPath);

    const gradleDepsAdded = mergeGradleDeps(androidPlugins, buildGradlePath);
    const gradleConflicts = computeGradleMerge(androidPlugins).conflicts;
    const nativeDependenciesPackage = generateNativeDependenciesPackage(iosPlugins);
    writeFileSync(iosNativeDependenciesPackagePathVar, nativeDependenciesPackage + "\n", "utf-8");

    const permissionsAdded = mergePermissions(androidPlugins, manifestPath);
    const manifestEntriesAdded = mergeManifestEntries(androidPlugins, manifestPath, config.pluginConfig);
    const proguardRulesAdded = mergeProguardRules(androidPlugins, proguardRulesPath);
    const iosPermissionsAdded = mergeInfoPlist(iosPlugins, iosInfoPlistPathVar);

    for (const [env, values] of Object.entries(config.environments)) {
      injectEnvironmentConfig(buildGradlePath, env, values);

      injectEnvironmentConfigIos(iosXcconfigPath(projectDir, `Environment-${env}`), {
        bundleId: iosBundleId(config, env),
        appName: values.appName,
      });
    }

    if (config.icon) {
      await generateAndroidIcons(projectDir, config.icon, resDir);
      await generateIosIcons(projectDir, config.icon, iosAppIconSetDir);
    }

    const resolvedSplash = resolveSplash(config);
    generateSplash(projectDir, resolvedSplash, webAssetsDir);
    generateSplash(projectDir, resolvedSplash, iosWebAssetsDirPath);
    const splashConfigValues = {
      enabled: resolvedSplash.enabled,
      minDuration: resolvedSplash.enabled ? resolvedSplash.minDuration : SPLASH_DEFAULTS.minDuration,
      maxDuration: resolvedSplash.enabled ? resolvedSplash.maxDuration : SPLASH_DEFAULTS.maxDuration,
      dismissOn: resolvedSplash.enabled ? resolvedSplash.dismissOn : SPLASH_DEFAULTS.dismissOn,
      transition: resolvedSplash.enabled ? resolvedSplash.transition : SPLASH_DEFAULTS.transition,
    };
    injectSplashConfig(buildGradlePath, splashConfigValues);
    injectSplashConfigIos(iosBuildConfigPathVar, splashConfigValues);

    const launchBackground = resolveLaunchBackground(config, projectDir);
    injectLaunchBackgroundAndroid(androidColorsPath(projectDir), launchBackground);
    injectLaunchBackgroundIos(iosLaunchScreenStoryboardPath(projectDir), launchBackground);

    injectOrientationAndroid(manifestPath, buildGradlePath, Boolean(config.landscape));
    injectOrientationIos(iosInfoPlistPathVar, iosBuildConfigPathVar, Boolean(config.landscape));

    const deepLinks = Object.fromEntries(
      Object.keys(config.environments).map((env) => [env, resolveDeepLinks(config, env)]),
    );
    injectDeepLinksAndroid(androidAppModuleDir(projectDir), deepLinks);
    injectDeepLinksIos(iosInfoPlistPathVar, iosConfigDir(projectDir), deepLinks);

    const kotlin = generateRegistryKotlin(androidPlugins, namespace, extraction);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, kotlin + "\n", "utf-8");

    const swift = generateRegistrySwift(iosPlugins, iosExtraction);
    mkdirSync(dirname(iosOutFile), { recursive: true });
    writeFileSync(iosOutFile, swift + "\n", "utf-8");

    writeLockfile(projectDir, plugins);
    writeSyncMarker(projectDir);

    return {
      plugins: plugins.map((p) => p.manifest.name),
      unresolvedRegisteredPlugins: unresolved,
      outFile,
      pluginSourceDir,
      gradleDepsAdded,
      gradleConflicts,
      permissionsAdded,
      manifestEntriesAdded,
      proguardRulesAdded,
      webAssetsDir,
      environments: Object.keys(config.environments),
      deepLinks,
      iosOutFile,
      iosPluginSourceDir: iosPluginSourceDirPath,
      iosPluginsWithNativeSource,
      iosPermissionsAdded,
      iosWebAssetsDir: iosWebAssetsDirPath,
    };
  };

  const result = ejected
    ? await runTransactionalSync(
        [
          outFile,
          pluginSourceDir,
          buildGradlePath,
          manifestPath,
          webAssetsDir,
          proguardRulesPath,
          iosOutFile,
          iosPluginSourceDirPath,
          iosBuildConfigPathVar,
          iosInfoPlistPathVar,
          iosWebAssetsDirPath,
          iosNativeDependenciesPackagePathVar,
          iosConfigDir(projectDir),
          ...Object.keys(config.environments).flatMap((env) => [
            androidFlavorManifestPath(androidAppModuleDir(projectDir), env),
            iosEntitlementsPath(iosAppDir(projectDir), env),
          ]),
        ],
        doSync,
      )
    : await doSync();

  await runHook(projectDir, "sync", "after");

  return result;
}
