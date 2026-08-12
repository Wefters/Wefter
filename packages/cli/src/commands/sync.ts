import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  auditPluginPermissions,
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
  mergePermissions,
  mergeProguardRules,
  validatePluginDirectory,
  type PluginExtraction,
  type PluginExtractionSwift,
} from "@wefter/registry-codegen";
import {
  androidAppModuleDir,
  androidBuildGradlePath,
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
  iosNativeDependenciesPackagePath,
  iosPluginSourceDir,
  iosProjectRootDir,
  iosWebAssetsDir,
  iosXcconfigPath,
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
import { shellTemplatePath, iosShellTemplatePath } from "../native/shell-template.js";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../plugins/registry.js";
import { checkLockDrift, writeLockfile } from "../plugins/lockfile.js";
import { writeSyncMarker } from "../plugins/sync-freshness.js";
import { runHook } from "../hooks/run-hook.js";

export interface SyncResult {
  plugins: string[];
  unresolvedRegisteredPlugins: string[];
  outFile: string;
  pluginSourceDir: string;
  gradleDepsAdded: string[];
  permissionsAdded: string[];
  proguardRulesAdded: string[];
  webAssetsDir: string;
  environments: string[];
  
  iosOutFile: string;
  iosPluginSourceDir: string;
  iosPluginsWithNativeSource: string[];
  iosPermissionsAdded: Record<string, string>;
  iosWebAssetsDir: string;
}

const PRESERVED_DIR_NAMES = new Set(["build", ".gradle"]);

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

function recreateNativeShell(projectDir: string): void {
  const root = androidProjectRootDir(projectDir);
  removePreservingBuildDirs(root);
  cpSync(shellTemplatePath(), root, {
    recursive: true,
    filter: (src) => !/[\\/](build|\.gradle)([\\/]|$)/.test(src),
  });
}

function recreateIosNativeShell(projectDir: string): void {
  const root = iosProjectRootDir(projectDir);
  removePreservingBuildDirs(root);
  cpSync(iosShellTemplatePath(), root, {
    recursive: true,
    filter: (src) => !/[\\/]build([\\/]|$)/.test(src),
  });
}

export interface SyncOptions {
  requireWebAssets?: boolean;
  updateLock?: boolean;
}

export async function sync(
  projectDir: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
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

  const doSync = async (): Promise<SyncResult> => {
    const pluginsDir = pluginsDirPath(projectDir, config);

    const plugins = resolveRegisteredPlugins(pluginsDir, config.plugins);
    const unresolved = unresolvedRegisteredPlugins(pluginsDir, config.plugins);

    const permissionViolations = auditPluginPermissions(plugins);
    if (permissionViolations.length > 0) {
      throw new Error(
        `Plugin permission audit failed:\n${permissionViolations.map((v) => `  - ${v}`).join("\n")}`,
      );
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
    const nativeDependenciesPackage = generateNativeDependenciesPackage(iosPlugins);
    writeFileSync(iosNativeDependenciesPackagePathVar, nativeDependenciesPackage + "\n", "utf-8");

    const permissionsAdded = mergePermissions(androidPlugins, manifestPath);
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
      permissionsAdded,
      proguardRulesAdded,
      webAssetsDir,
      environments: Object.keys(config.environments),
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
        ],
        doSync,
      )
    : await doSync();

  await runHook(projectDir, "sync", "after");

  return result;
}
