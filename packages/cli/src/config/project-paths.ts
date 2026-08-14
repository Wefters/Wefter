import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WefterConfigSchema, type WefterConfig } from "./wefter-config-schema.js";

export type { WefterConfig };

const NATIVE_ROOT = ".wefter/native/android";
const EJECT_MARKER = ".wefter-ejected";

export function androidNamespace(config: WefterConfig): string {
  const envs = config.environments;
  const canonical = envs.production ?? envs.development ?? Object.values(envs)[0];
  if (!canonical) {
    throw new Error(
      "wefter.config.json needs at least one environment with an appId — the Android package is derived from it.",
    );
  }
  return canonical.appId;
}

export function androidPackagePath(config: WefterConfig): string {
  return androidNamespace(config).replace(/\./g, "/");
}

export function loadWefterConfig(projectDir: string): WefterConfig {
  const configPath = join(projectDir, "wefter.config.json");
  const raw = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf-8")) : {};

  const result = WefterConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid wefter.config.json: ${result.error.message}`);
  }
  return result.data;
}

export function pluginsDirPath(projectDir: string, config: WefterConfig): string {
  return join(projectDir, config.pluginsDir);
}

export function isEjected(projectDir: string): boolean {
  return existsSync(join(projectDir, EJECT_MARKER));
}

export function ejectMarkerPath(projectDir: string): string {
  return join(projectDir, EJECT_MARKER);
}

export function androidProjectRootDir(projectDir: string): string {
  if (isEjected(projectDir)) return join(projectDir, "android");
  return join(projectDir, NATIVE_ROOT);
}

export function androidAppModuleDir(projectDir: string): string {
  return join(androidProjectRootDir(projectDir), "app");
}

export function androidGeneratedRegistryPath(projectDir: string, config: WefterConfig): string {
  return join(androidAppModuleDir(projectDir), "src/main/java", androidPackagePath(config), "GeneratedRegistry.kt");
}

export function androidPluginSourceDir(projectDir: string, config: WefterConfig): string {
  return join(androidAppModuleDir(projectDir), "src/main/java", androidPackagePath(config), "plugins");
}

export function androidBuildGradlePath(projectDir: string): string {
  return join(androidAppModuleDir(projectDir), "build.gradle.kts");
}

export function androidManifestPath(projectDir: string): string {
  return join(androidAppModuleDir(projectDir), "src/main/AndroidManifest.xml");
}

export function androidWebAssetsDir(projectDir: string): string {
  return join(androidAppModuleDir(projectDir), "src/main/assets/www");
}

export function androidDebugNetworkSecurityConfigPath(projectDir: string): string {
  return join(androidAppModuleDir(projectDir), "src/debug/res/xml/network_security_config.xml");
}

export function androidProguardRulesPath(projectDir: string): string {
  return join(androidAppModuleDir(projectDir), "proguard-rules.pro");
}

export function androidResDir(projectDir: string): string {
  return join(androidAppModuleDir(projectDir), "src/main/res");
}

export function androidThemesPath(projectDir: string): string {
  return join(androidResDir(projectDir), "values/themes.xml");
}

export function androidColorsPath(projectDir: string): string {
  return join(androidResDir(projectDir), "values/colors.xml");
}

const IOS_NATIVE_ROOT = ".wefter/native/ios";
const IOS_EJECT_DIR_NAME = "ios";

export function iosProjectRootDir(projectDir: string): string {
  if (isEjected(projectDir)) return join(projectDir, IOS_EJECT_DIR_NAME);
  return join(projectDir, IOS_NATIVE_ROOT);
}

export function iosAppDir(projectDir: string): string {
  return join(iosProjectRootDir(projectDir), "WefterBridge");
}

export function iosXcodeProjectPath(projectDir: string): string {
  return join(iosProjectRootDir(projectDir), "WefterBridge.xcodeproj");
}

export function iosConfigDir(projectDir: string): string {
  return join(iosProjectRootDir(projectDir), "Config");
}

export function iosXcconfigPath(projectDir: string, name: string): string {
  return join(iosConfigDir(projectDir), `${name}.xcconfig`);
}

export function iosGeneratedRegistryPath(projectDir: string): string {
  return join(iosAppDir(projectDir), "GeneratedRegistry.swift");
}

export function iosPluginSourceDir(projectDir: string): string {
  return join(iosAppDir(projectDir), "Plugins");
}

export function iosInfoPlistPath(projectDir: string): string {
  return join(iosAppDir(projectDir), "Info.plist");
}

export function iosWebAssetsDir(projectDir: string): string {
  return join(iosAppDir(projectDir), "www");
}

export function iosBuildConfigPath(projectDir: string): string {
  return join(iosAppDir(projectDir), "BuildConfig.swift");
}

export function iosLaunchScreenStoryboardPath(projectDir: string): string {
  return join(iosAppDir(projectDir), "LaunchScreen.storyboard");
}

export function iosNativeDependenciesDir(projectDir: string): string {
  return join(iosProjectRootDir(projectDir), "NativeDependencies");
}

export function iosNativeDependenciesPackagePath(projectDir: string): string {
  return join(iosNativeDependenciesDir(projectDir), "Package.swift");
}

export function iosBundleId(config: WefterConfig, env: string): string {
  const environment = config.environments[env];
  if (!environment) {
    throw new Error(`Unknown environment "${env}" — cannot derive an iOS bundle identifier.`);
  }
  return environment.iosBundleId ?? environment.appId;
}
