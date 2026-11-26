/** `wefter build`: builds an installable Android APK or iOS simulator app for an environment. */

import { buildAndroid, type AndroidBuildResult } from "../native/android-builder.js";
import { buildIos, type IosBuildResult } from "../native/ios-builder.js";
import { checkReleaseSecurity } from "../native/release-security-check.js";
import { checkReleaseSecurityIos } from "../native/release-security-check-ios.js";
import { checkInfoPlistPermissionKeys } from "../native/check-info-plist-permissions.js";
import { loadWefterConfig, pluginsDirPath } from "../config/project-paths.js";
import { checkSyncFreshness } from "../plugins/sync-freshness.js";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../plugins/registry.js";
import { runHook } from "../hooks/run-hook.js";
import { step } from "../ui/steps.js";

/** The built APK and what went into it. */
export interface BuildResult extends AndroidBuildResult {
  appName: string;
  syncedPlugins: string[];
  unresolvedRegisteredPlugins: string[];
}

/** Which environment to build, and whether as a release. */
export interface BuildOptions {
  release: boolean;
  env: string;
}

/** `development, debug` and the like, for progress messages. */
function buildLabel(options: BuildOptions): string {
  return `${options.env}, ${options.release ? "release" : "debug"}`;
}

/**
 * Builds the Android app.
 *
 * Requires an up-to-date sync, runs the `wefter:build` hooks around the build, and for release builds first
 * runs the release security check.
 *
 * @throws {Error} When the project needs a sync or the release check fails.
 * @throws {ProcessFailure} When Gradle fails.
 */
export async function build(projectDir: string, options: BuildOptions): Promise<BuildResult> {
  const freshness = checkSyncFreshness(projectDir);
  if (!freshness.fresh) {
    throw new Error(freshness.reason);
  }

  const config = loadWefterConfig(projectDir);

  await runHook(projectDir, "build", "before", { platform: "android", environment: options.env });

  if (options.release) {
    const releaseCheck = checkReleaseSecurity(projectDir, config);
    if (!releaseCheck.passed) {
      throw new Error(`Release security check failed:\n${releaseCheck.issues.map((i) => `  - ${i}`).join("\n")}`);
    }
  }

  const pluginsDir = pluginsDirPath(projectDir, config);
  const resolved = resolveRegisteredPlugins(pluginsDir, config.plugins);
  const unresolved = unresolvedRegisteredPlugins(pluginsDir, config.plugins);

  const { apkPath, sizeBytes } = await step(`Building Android app (${buildLabel(options)})`, (s) =>
    buildAndroid(projectDir, config, options.env, options.release, { onProgress: s.detail }),
  );

  await runHook(projectDir, "build", "after", { platform: "android", environment: options.env });

  return {
    apkPath,
    sizeBytes,
    appName: config.environments[options.env]?.appName ?? "app",
    syncedPlugins: resolved.map((p) => p.manifest.name),
    unresolvedRegisteredPlugins: unresolved,
  };
}

/** The built iOS app and what went into it. */
export interface IosBuildCommandResult extends IosBuildResult {
  appName: string;
  syncedPlugins: string[];
  unresolvedRegisteredPlugins: string[];
}

/** iOS build options; `simulator` picks the simulator to build for. */
export interface IosBuildCommandOptions extends BuildOptions {
  simulator?: string;
}

/**
 * Builds the iOS app.
 *
 * Requires an up-to-date sync, runs the `wefter:build` hooks around the build, checks that `Info.plist`
 * has every permission description the plugins need, and for release builds first runs the release
 * security check.
 *
 * @throws {Error} When the project needs a sync or a check fails.
 * @throws {ProcessFailure} When xcodebuild fails.
 */
export async function buildIosCommand(
  projectDir: string,
  options: IosBuildCommandOptions,
): Promise<IosBuildCommandResult> {
  const freshness = checkSyncFreshness(projectDir);
  if (!freshness.fresh) {
    throw new Error(freshness.reason);
  }

  const config = loadWefterConfig(projectDir);

  await runHook(projectDir, "build", "before", { platform: "ios", environment: options.env });

  if (options.release) {
    const releaseCheck = checkReleaseSecurityIos(projectDir, config);
    if (!releaseCheck.passed) {
      throw new Error(`Release security check failed:\n${releaseCheck.issues.map((i) => `  - ${i}`).join("\n")}`);
    }
  }

  const pluginsDir = pluginsDirPath(projectDir, config);
  const resolved = resolveRegisteredPlugins(pluginsDir, config.plugins);
  const unresolved = unresolvedRegisteredPlugins(pluginsDir, config.plugins);

  const plistCheck = checkInfoPlistPermissionKeys(projectDir, resolved);
  if (!plistCheck.passed) {
    throw new Error(
      `iOS permission configuration check failed:\n${plistCheck.issues.map((i) => `  - ${i}`).join("\n")}`,
    );
  }

  const { appPath, sizeBytes } = await step(`Building iOS app (${buildLabel(options)})`, (s) =>
    buildIos(projectDir, config, options.env, options.release, {
      simulator: options.simulator,
      onProgress: s.detail,
    }),
  );

  await runHook(projectDir, "build", "after", { platform: "ios", environment: options.env });

  return {
    appPath,
    sizeBytes,
    appName: config.environments[options.env]?.appName ?? "app",
    syncedPlugins: resolved.map((p) => p.manifest.name),
    unresolvedRegisteredPlugins: unresolved,
  };
}
