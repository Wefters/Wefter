import { buildAndroid, type AndroidBuildResult } from "../native/android-builder.js";
import { buildIos, type IosBuildResult } from "../native/ios-builder.js";
import { checkReleaseSecurity } from "../native/release-security-check.js";
import { checkReleaseSecurityIos } from "../native/release-security-check-ios.js";
import { checkInfoPlistPermissionKeys } from "../native/check-info-plist-permissions.js";
import { loadWefterConfig, pluginsDirPath } from "../config/project-paths.js";
import { checkSyncFreshness } from "../plugins/sync-freshness.js";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../plugins/registry.js";
import { runHook } from "../hooks/run-hook.js";

export interface BuildResult extends AndroidBuildResult {
  syncedPlugins: string[];
  unresolvedRegisteredPlugins: string[];
}

export interface BuildOptions {
  release: boolean;
  env: string;
}

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
      throw new Error(
        `Release security check failed:\n${releaseCheck.issues.map((i) => `  - ${i}`).join("\n")}`,
      );
    }
  }

  const pluginsDir = pluginsDirPath(projectDir, config);
  const resolved = resolveRegisteredPlugins(pluginsDir, config.plugins);
  const unresolved = unresolvedRegisteredPlugins(pluginsDir, config.plugins);

  const { apkPath, sizeBytes } = await buildAndroid(projectDir, config, options.env, options.release);

  await runHook(projectDir, "build", "after", { platform: "android", environment: options.env });

  return {
    apkPath,
    sizeBytes,
    syncedPlugins: resolved.map((p) => p.manifest.name),
    unresolvedRegisteredPlugins: unresolved,
  };
}

export interface IosBuildCommandResult extends IosBuildResult {
  syncedPlugins: string[];
  unresolvedRegisteredPlugins: string[];
}

export interface IosBuildCommandOptions extends BuildOptions {
  simulator?: string;
}

export async function buildIosCommand(projectDir: string, options: IosBuildCommandOptions): Promise<IosBuildCommandResult> {
  const freshness = checkSyncFreshness(projectDir);
  if (!freshness.fresh) {
    throw new Error(freshness.reason);
  }

  const config = loadWefterConfig(projectDir);

  await runHook(projectDir, "build", "before", { platform: "ios", environment: options.env });

  if (options.release) {
    const releaseCheck = checkReleaseSecurityIos(projectDir, config);
    if (!releaseCheck.passed) {
      throw new Error(
        `Release security check failed:\n${releaseCheck.issues.map((i) => `  - ${i}`).join("\n")}`,
      );
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

  const { appPath, sizeBytes } = await buildIos(projectDir, config, options.env, options.release, {
    simulator: options.simulator,
  });

  await runHook(projectDir, "build", "after", { platform: "ios", environment: options.env });

  return {
    appPath,
    sizeBytes,
    syncedPlugins: resolved.map((p) => p.manifest.name),
    unresolvedRegisteredPlugins: unresolved,
  };
}
