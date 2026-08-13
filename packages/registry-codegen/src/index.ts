export {
  PluginManifestSchema,
  type PluginManifest,
  type ManifestEntry,
  type IntentFilter,
  type IntentFilterData,
} from './schema/plugin-schema.js';
export { scanPlugins, type DiscoveredPlugin } from './scan-plugins.js';
export { auditPluginPermissions } from './audit-permissions.js';
export { readPluginKotlinSource } from './read-kotlin-source.js';
export {
  extractWefterMethods,
  findMalformedWefterMethods,
  extractWefterHooks,
  findMalformedWefterHooks,
  extractDeclaredClassNames,
  type ExtractedMethod,
  type ExtractedHook,
} from './extract-wefter-plugin.js';
export { auditPluginConsistency } from './audit-plugin-consistency.js';
export { auditPermissionHandling } from './audit-permission-handling.js';
export { generateRegistryKotlin, classNameFor, type PluginExtraction } from './codegen-android.js';
export { copyAndroidNativeSource } from './copy-native-source.js';
export { mergeGradleDeps, computeGradleMerge, type GradleMergeResult } from './merge-gradle-deps.js';
export { mergePermissions } from './merge-permissions.js';
export { mergeManifestEntries, extractRequiredPluginConfigKeys, type MergedManifestEntry } from './manifest-entries.js';
export { copyWebAssets } from './copy-web-assets.js';
export { mergeProguardRules } from './merge-proguard-rules.js';
export { injectEnvironmentConfig, type EnvironmentValues } from './inject-environment.js';
export { injectSplashConfig, type SplashConfigValues } from './inject-splash.js';
export { validatePluginDirectory, type PluginValidationResult } from './validate-plugin.js';

export { readPluginSwiftSource } from './read-swift-source.js';
export {
  extractWefterMethodsSwift,
  findMalformedWefterMethodsSwift,
  extractWefterHooksSwift,
  findMalformedWefterHooksSwift,
  type ExtractedMethod as ExtractedMethodSwift,
  type ExtractedHook as ExtractedHookSwift,
} from './extract-wefter-plugin-swift.js';
export { generateRegistrySwift, type PluginExtractionSwift } from './codegen-ios.js';
export { copyIosNativeSource } from './copy-native-source-ios.js';
export { mergeInfoPlist } from './merge-info-plist.js';
export { generateNativeDependenciesPackage } from './generate-native-dependencies-package.js';
