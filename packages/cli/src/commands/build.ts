/**
 * `wefter build`: builds the app for release or testing.
 *
 * 1. Validate: environment, version and build number, output folder, and signing for a release.
 * 2. `wefter:build:before` hook (build the web app here).
 * 3. Sync: the web app and config are copied into the native projects (runs the `wefter:sync` hooks).
 * 4. Version: the version and build number are written into the native projects.
 * 5. Release checks (`--release`): errors stop the build; warnings stop it with `--strict`.
 * 6. Native build: Gradle (APK, App Bundle or both), or xcodebuild (simulator app, or an archive exported
 *    as an `.ipa`).
 * 7. Collect: built files, crash-report symbols and `build-info.json` go to `<output>/<platform>/<env>/<version>-<build>/`.
 * 8. `wefter:build:after` hook with the built files, or `wefter:build:failed` when anything fails.
 */

import { existsSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildAndroid } from "../native/android-builder.js";
import {
  archiveIos,
  buildIos,
  exportIpa,
  packageUnsignedIpa,
  pathSize,
  zipArchiveDsyms,
} from "../native/ios-builder.js";
import { checkInfoPlistPermissionKeys } from "../native/check-info-plist-permissions.js";
import { withoutDevServerAndroid, withoutDevServerIos } from "../native/without-dev-server.js";
import { injectVersionAndroid, injectVersionIos } from "../native/inject-version.js";
import { verify16KbAlignment, verifyAabSignature, verifyApkSignature } from "../native/android-verify.js";
import { readKeystoreFingerprint } from "../native/certificate-fingerprint.js";
import { readXcodeVersion, renderExportOptions } from "../native/export-options.js";
import {
  androidBuildGradlePath,
  iosBuildConfigPath,
  iosBundleId,
  iosInfoPlistPath,
  iosProjectRootDir,
  iosSharedXcconfigPath,
  loadWefterConfig,
  pluginsDirPath,
  readRawConfig,
} from "../config/project-paths.js";
import {
  LEGACY_IOS_EXPORT_METHODS,
  IOS_EXPORT_METHODS,
  ANDROID_FORMATS,
  type AndroidFormat,
  type IosExportMethod,
  type WefterConfig,
} from "../config/wefter-config-schema.js";
import { resolveAndroidSigning, resolveIosSigning } from "../config/signing-config.js";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../plugins/registry.js";
import { runHook, type HookContext } from "../hooks/run-hook.js";
import { sync } from "./sync.js";
import { resolveAppVersion, type AppVersion } from "../app-build/app-version.js";
import {
  buildOutputDir,
  collectArtifact,
  gitState,
  resolveOutputRoot,
  writeBuildInfo,
  type Artifact,
  type BuildInfo,
} from "../app-build/artifacts.js";
import { runReleaseChecks } from "../app-build/release-checks.js";
import { fileSafeAppName } from "../native/android-builder.js";
import { step } from "../ui/steps.js";

/** Platforms `wefter build` builds for. */
export type BuildPlatform = "android" | "ios";

/** Set while a build runs, so a hook that starts another `wefter build` is stopped instead of looping. */
export const BUILD_ACTIVE_ENV = "WEFTER_BUILD_ACTIVE";

/**
 * How to build.
 *
 * - `release`: a release build, signed for the stores (`env` then defaults to `production`).
 * - `env`: the environment; `development` for debug builds and `production` for release builds by default.
 * - `appVersion`, `buildNumber`: override the configured version and build number.
 * - `format`: Android output; release builds default to `both` (App Bundle and APK), debug builds to `apk`.
 * - `output`: folder for the built files, instead of `build.output` from the config.
 * - `unsigned`: build a release without signing it, to sign it elsewhere.
 * - `strict`: treat release check warnings as errors.
 * - `clean`: clean the native build caches first.
 * - `simulator`: iOS: build for this simulator. Release builds without it are device builds (`.ipa`).
 * - `exportMethod`: iOS: how to export the `.ipa`, instead of `build.ios.exportMethod`.
 * - `onWarning`: receives each warning as it is found.
 */
export interface BuildOptions {
  release: boolean;
  env?: string;
  appVersion?: string;
  buildNumber?: string | number;
  format?: AndroidFormat | string;
  output?: string;
  unsigned?: boolean;
  strict?: boolean;
  clean?: boolean;
  simulator?: string;
  exportMethod?: string;
  onWarning?: (message: string) => void;
}

/** One platform's build: what was built, where it went, and what to know about it. */
export interface PlatformBuildResult {
  platform: BuildPlatform;
  appName: string;
  appId: string;
  env: string;
  release: boolean;
  appVersion: AppVersion;
  /** iOS: whether this was a simulator build or a device build. */
  target?: "simulator" | "device";
  format?: AndroidFormat;
  artifacts: Artifact[];
  /** The main file: the App Bundle, APK, `.ipa` or simulator `.app`. */
  primary: Artifact;
  outputDir: string;
  buildInfoPath: string;
  buildInfo: BuildInfo;
  signingCertificateSha256?: string;
  warnings: string[];
  /** When the copied web app was built (its `index.html`), to spot a stale web build. */
  webBuiltAt?: Date;
  syncedPlugins: string[];
  unresolvedRegisteredPlugins: string[];
}

/** {@link PlatformBuildResult} for Android, with the APK path and size as earlier versions returned them. */
export interface BuildResult extends PlatformBuildResult {
  apkPath?: string;
  sizeBytes: number;
}

/** {@link PlatformBuildResult} for iOS, with the app path and size as earlier versions returned them. */
export interface IosBuildCommandResult extends PlatformBuildResult {
  appPath: string;
  sizeBytes: number;
}

/** iOS build options, as earlier versions took them. */
export type IosBuildCommandOptions = BuildOptions;

/**
 * The environment to build: `env`, else `production` for a release and `development` otherwise.
 *
 * @throws {Error} Listing the configured environments when it does not exist.
 */
export function resolveBuildEnvironment(config: WefterConfig, options: Pick<BuildOptions, "env" | "release">): string {
  const env = options.env ?? (options.release ? "production" : "development");
  if (!config.environments[env]) {
    const configured = Object.keys(config.environments).join(", ") || "none";
    const defaulted = options.env === undefined;
    throw new Error(
      `Unknown environment "${env}". Configured environments: ${configured}.` +
        (defaulted && options.release
          ? ` Release builds use "production" unless --env is given: add a "production" environment to wefter.config.json, or pass --env.`
          : ""),
    );
  }
  return env;
}

/**
 * The Android format: `format`, else `build.android.format`, else `both` for a release and `apk` otherwise.
 *
 * @throws {Error} When `format` is not apk, aab or both.
 */
export function resolveAndroidFormat(
  config: WefterConfig,
  options: Pick<BuildOptions, "format" | "release">,
): AndroidFormat {
  const format = options.format ?? config.build.android.format ?? (options.release ? "both" : "apk");
  if (!(ANDROID_FORMATS as readonly string[]).includes(format)) {
    throw new Error(`Unknown --format "${format}". Use apk, aab or both.`);
  }
  return format as AndroidFormat;
}

/**
 * The iOS export method: `exportMethod` (current or older name), else `build.ios.exportMethod`.
 *
 * @throws {Error} When it is not a known method.
 */
export function resolveExportMethod(config: WefterConfig, option?: string): IosExportMethod {
  if (option === undefined) return config.build.ios.exportMethod;
  const method = LEGACY_IOS_EXPORT_METHODS[option] ?? option;
  if (!(IOS_EXPORT_METHODS as readonly string[]).includes(method)) {
    throw new Error(
      `Unknown --export-method "${option}". Use ${IOS_EXPORT_METHODS.join(", ")} (or the older app-store, ad-hoc, development).`,
    );
  }
  return method as IosExportMethod;
}

/** Whether an iOS build is for a simulator: debug builds, and release builds given `--simulator`. */
function isSimulatorBuild(options: BuildOptions): boolean {
  return !options.release || options.simulator !== undefined;
}

/**
 * Checks signing before anything runs, so a release does not fail after a long build.
 *
 * @throws {Error} Listing what is missing.
 */
function validateSigning(
  projectDir: string,
  config: WefterConfig,
  platform: BuildPlatform,
  options: BuildOptions,
): void {
  if (!options.release || options.unsigned) return;
  if (platform === "android") {
    const signing = resolveAndroidSigning(projectDir, config);
    const problems = signing
      ? signing.problems
      : [
          'no signing settings: add "signing": { "android": { "keystorePath", "keyAlias", "storePassword" } } to wefter.config.json',
        ];
    if (problems.length > 0) {
      throw new Error(
        `Android release signing is not ready:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
          `Build with --unsigned to sign the app elsewhere.`,
      );
    }
  } else if (!isSimulatorBuild(options)) {
    const signing = resolveIosSigning(projectDir, config);
    const problems = signing
      ? signing.problems
      : ['no signing settings: add "signing": { "ios": { "teamId": … } } to wefter.config.json'];
    if (problems.length > 0) {
      throw new Error(
        `iOS release signing is not ready:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
          `Build with --unsigned to sign the app elsewhere, or --simulator for a simulator build.`,
      );
    }
  }
}

/** Variables every build hook gets, on top of the standard ones. */
function hookVariables(
  options: BuildOptions,
  appVersion: AppVersion,
  outputRoot: string,
  format: AndroidFormat | undefined,
): Record<string, string> {
  return {
    WEFTER_RELEASE: String(options.release),
    WEFTER_APP_VERSION: appVersion.version,
    WEFTER_BUILD_NUMBER: String(appVersion.buildNumber),
    WEFTER_FORMAT: format ?? "",
    WEFTER_OUTPUT_DIR: outputRoot,
  };
}

/** Everything the per-platform build needs, prepared once. */
interface BuildContext {
  projectDir: string;
  config: WefterConfig;
  rawConfig: unknown;
  env: string;
  appVersion: AppVersion;
  outputRoot: string;
  options: BuildOptions;
  syncedPlugins: string[];
  unresolvedRegisteredPlugins: string[];
}

/**
 * Builds the app for each platform in `platforms`, running the steps listed at the top of this file. The
 * `before` hook and sync run once; the native build, output and `after` hook run per platform.
 *
 * @throws {Error} When validation, a hook, sync or a release check fails.
 * @throws {ProcessFailure} When Gradle or xcodebuild fails.
 */
export async function buildApp(
  projectDir: string,
  platforms: BuildPlatform[],
  options: BuildOptions,
): Promise<PlatformBuildResult[]> {
  if (process.env[BUILD_ACTIVE_ENV]) {
    throw new Error(
      "`wefter build` is already running; a build hook (or a script it runs) started it again. " +
        'Build the web app in "wefter:build:before" without calling `wefter build`.',
    );
  }

  const config = loadWefterConfig(projectDir);
  const env = resolveBuildEnvironment(config, options);
  const appVersion = resolveAppVersion(projectDir, config, {
    appVersion: options.appVersion,
    buildNumber: options.buildNumber,
  });
  const outputRoot = resolveOutputRoot(projectDir, config.build.output, config.webDir, options.output);
  const format = platforms.includes("android") ? resolveAndroidFormat(config, options) : undefined;
  if (platforms.includes("ios")) {
    resolveExportMethod(config, options.exportMethod);
    if (process.platform !== "darwin") throw new Error("iOS apps can only be built on macOS, with Xcode.");
  }
  for (const platform of platforms) validateSigning(projectDir, config, platform, options);

  const hookPlatform: HookContext["platform"] = platforms.length === 1 ? platforms[0] : "all";
  const baseVariables = hookVariables(options, appVersion, outputRoot, format);

  process.env[BUILD_ACTIVE_ENV] = "1";
  let currentPlatform: HookContext["platform"] = hookPlatform;
  try {
    await runHook(projectDir, "build", "before", { platform: hookPlatform, environment: env, env: baseVariables });

    const synced = await step("Syncing the native projects", () => sync(projectDir, { requireWebAssets: true }));
    const pluginsDir = pluginsDirPath(projectDir, config);
    const context: BuildContext = {
      projectDir,
      config,
      rawConfig: readRawConfig(projectDir),
      env,
      appVersion,
      outputRoot,
      options,
      syncedPlugins: resolveRegisteredPlugins(pluginsDir, config.plugins).map((p) => p.manifest.name),
      unresolvedRegisteredPlugins:
        synced.unresolvedRegisteredPlugins ?? unresolvedRegisteredPlugins(pluginsDir, config.plugins),
    };

    const results: PlatformBuildResult[] = [];
    for (const platform of platforms) {
      currentPlatform = platform;
      const result =
        platform === "android" ? await buildAndroidPlatform(context, format!) : await buildIosPlatform(context);
      results.push(result);

      await runHook(projectDir, "build", "after", {
        platform,
        environment: env,
        env: {
          ...baseVariables,
          WEFTER_ARTIFACT: result.primary.path,
          WEFTER_ARTIFACTS: JSON.stringify(result.artifacts.map((a) => ({ kind: a.kind, path: a.path }))),
          WEFTER_BUILD_INFO: result.buildInfoPath,
          WEFTER_BUILD_DIR: result.outputDir,
        },
      });
    }
    return results;
  } catch (error) {
    await runFailedHook(projectDir, currentPlatform, env, baseVariables, error);
    throw error;
  } finally {
    delete process.env[BUILD_ACTIVE_ENV];
  }
}

/** Runs `wefter:build:failed`; its own failure is reported as a warning so it never hides the build error. */
async function runFailedHook(
  projectDir: string,
  platform: HookContext["platform"],
  env: string,
  variables: Record<string, string>,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await runHook(projectDir, "build", "failed", {
      platform,
      environment: env,
      env: { ...variables, WEFTER_ERROR: message.split("\n")[0] },
    });
  } catch (hookError) {
    process.stderr.write(
      `wefter:build:failed did not finish: ${hookError instanceof Error ? hookError.message : String(hookError)}\n`,
    );
  }
}

/** Runs the release checks for a platform, reporting warnings, and stops on errors (or warnings with strict). */
async function releaseChecks(context: BuildContext, platform: BuildPlatform, outputDir: string): Promise<string[]> {
  const { projectDir, config, env, appVersion, options } = context;
  return step(
    "Checking release readiness",
    async () => {
      const result = await runReleaseChecks({
        projectDir,
        config,
        rawConfig: context.rawConfig,
        platform,
        env,
        appVersion,
        outputRoot: context.outputRoot,
        outputDir,
        unsigned: options.unsigned || (platform === "ios" && isSimulatorBuild(options)),
        exportMethod:
          platform === "ios" && !isSimulatorBuild(options)
            ? resolveExportMethod(config, options.exportMethod)
            : undefined,
      });
      for (const warning of result.warnings) options.onWarning?.(warning);
      if (result.errors.length > 0) {
        throw new Error(`Release checks failed:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`);
      }
      if (options.strict && result.warnings.length > 0) {
        throw new Error(
          `Release checks found warnings, which --strict treats as errors:\n${result.warnings.map((w) => `  - ${w}`).join("\n")}`,
        );
      }
      return result.warnings;
    },
    {
      done: (warnings) =>
        `Release checks passed${warnings.length > 0 ? ` with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}`,
    },
  );
}

/** When the web app's `index.html` was last built. */
function webBuildTime(projectDir: string, config: WefterConfig): Date | undefined {
  const index = resolve(projectDir, config.webDir, "index.html");
  return existsSync(index) ? statSync(index).mtime : undefined;
}

/** Stops a `--strict` build on warnings found after compiling (signature or alignment checks). */
function failOnLateWarnings(options: BuildOptions, warnings: string[]): void {
  if (options.strict && warnings.length > 0) {
    throw new Error(
      `The build has warnings, which --strict treats as errors:\n${warnings.map((w) => `  - ${w}`).join("\n")}`,
    );
  }
}

/** Steps 4–7 for Android. */
async function buildAndroidPlatform(context: BuildContext, format: AndroidFormat): Promise<PlatformBuildResult> {
  const { projectDir, config, env, appVersion, options } = context;
  const environment = config.environments[env];
  const outputDir = buildOutputDir(context.outputRoot, "android", env, appVersion);

  injectVersionAndroid(androidBuildGradlePath(projectDir), appVersion);
  const warnings = options.release ? await releaseChecks(context, "android", outputDir) : [];

  const label = `Building Android ${format === "both" ? "App Bundle and APK" : format === "aab" ? "App Bundle" : "APK"} (${env}, ${options.release ? "release" : "debug"})`;
  const built = await step(label, (s) =>
    withoutDevServerAndroid(androidBuildGradlePath(projectDir), () =>
      buildAndroid(projectDir, config, env, options.release, {
        onProgress: s.detail,
        format,
        clean: options.clean,
        unsigned: options.unsigned,
        version: appVersion,
      }),
    ),
  );

  let fingerprint: string | undefined;
  const signed = !(options.release && options.unsigned);
  if (options.release && signed) {
    const lateWarnings = await step("Verifying signatures", async () => {
      const found: string[] = [];
      if (built.apkPath) {
        const apk = await verifyApkSignature(built.apkPath);
        if (apk.warning) found.push(apk.warning);
        fingerprint = apk.fingerprint;
        const alignment = await verify16KbAlignment(built.apkPath);
        if (alignment.warning) found.push(alignment.warning);
      }
      if (built.aabPath) {
        const aab = await verifyAabSignature(built.aabPath);
        if (aab.warning) found.push(aab.warning);
      }
      if (!fingerprint) {
        const signing = resolveAndroidSigning(projectDir, config);
        if (signing?.storePassword) {
          fingerprint = await readKeystoreFingerprint(
            signing.keystorePath,
            signing.keyAlias,
            signing.storePassword,
          ).catch(() => undefined);
        }
      }
      return found;
    });
    for (const warning of lateWarnings) options.onWarning?.(warning);
    warnings.push(...lateWarnings);
    failOnLateWarnings(options, lateWarnings);
  }

  const artifacts = await step("Copying to the output folder", async () => {
    const collected: Artifact[] = [];
    if (built.aabPath) collected.push(await collectArtifact("aab", built.aabPath, outputDir));
    if (built.apkPath) collected.push(await collectArtifact("apk", built.apkPath, outputDir));
    if (built.mappingPath) collected.push(await collectArtifact("mapping", built.mappingPath, outputDir));
    if (built.nativeSymbolsPath) {
      collected.push(await collectArtifact("native-symbols", built.nativeSymbolsPath, outputDir));
    }
    return collected;
  });

  const { path: buildInfoPath, info } = writeBuildInfo(
    outputDir,
    {
      app: { name: environment.appName, id: environment.appId },
      platform: "android",
      environment: env,
      release: options.release,
      version: appVersion.version,
      buildNumber: appVersion.buildNumber,
      format,
      signed,
      ...(fingerprint ? { signingCertificateSha256: fingerprint } : {}),
      git: gitState(projectDir),
    },
    artifacts,
  );

  const primary = artifacts.find((a) => a.kind === "aab") ?? artifacts.find((a) => a.kind === "apk")!;
  return {
    platform: "android",
    appName: environment.appName,
    appId: environment.appId,
    env,
    release: options.release,
    appVersion,
    format,
    artifacts,
    primary,
    outputDir,
    buildInfoPath,
    buildInfo: info,
    signingCertificateSha256: fingerprint,
    warnings,
    webBuiltAt: webBuildTime(projectDir, config),
    syncedPlugins: context.syncedPlugins,
    unresolvedRegisteredPlugins: context.unresolvedRegisteredPlugins,
  };
}

/** Steps 4–7 for iOS. */
async function buildIosPlatform(context: BuildContext): Promise<PlatformBuildResult> {
  const { projectDir, config, env, appVersion, options } = context;
  const environment = config.environments[env];
  const bundleId = iosBundleId(config, env);
  const outputDir = buildOutputDir(context.outputRoot, "ios", env, appVersion);
  const simulator = isSimulatorBuild(options);
  const exportMethod = resolveExportMethod(config, options.exportMethod);

  injectVersionIos(iosSharedXcconfigPath(projectDir), iosInfoPlistPath(projectDir), appVersion);

  const pluginsDir = pluginsDirPath(projectDir, config);
  const plistCheck = checkInfoPlistPermissionKeys(projectDir, resolveRegisteredPlugins(pluginsDir, config.plugins));
  if (!plistCheck.passed) {
    throw new Error(
      `iOS permission configuration check failed:\n${plistCheck.issues.map((i) => `  - ${i}`).join("\n")}`,
    );
  }

  const warnings = options.release ? await releaseChecks(context, "ios", outputDir) : [];
  const baseName = `${fileSafeAppName(environment.appName)}-${env}-${appVersion.version}-${appVersion.buildNumber}`;
  const artifacts: Artifact[] = [];
  let signed = false;

  if (simulator) {
    const { appPath } = await step(
      `Building iOS app for the simulator (${env}, ${options.release ? "release" : "debug"})`,
      (s) =>
        withoutDevServerIos(iosBuildConfigPath(projectDir), () =>
          buildIos(projectDir, config, env, options.release, {
            simulator: options.simulator,
            onProgress: s.detail,
            version: appVersion,
            clean: options.clean,
          }),
        ),
    );
    artifacts.push(await step("Copying to the output folder", () => collectArtifact("app", appPath, outputDir)));
  } else {
    const signing = options.unsigned ? null : resolveIosSigning(projectDir, config);
    const { archivePath } = await step(`Archiving iOS app (${env}, release)`, (s) =>
      withoutDevServerIos(iosBuildConfigPath(projectDir), () =>
        archiveIos(projectDir, env, {
          signing,
          unsigned: options.unsigned,
          version: appVersion,
          clean: options.clean,
          archiveName: baseName,
          onProgress: s.detail,
        }),
      ),
    );

    const ipaPath = join(iosProjectRootDir(projectDir), "build", "Export", `${baseName}.ipa`);
    let exported: string;
    if (options.unsigned || !signing) {
      exported = await step("Packaging unsigned .ipa", () => packageUnsignedIpa(archivePath, ipaPath));
    } else {
      const exportDir = join(iosProjectRootDir(projectDir), "build", "Export", baseName);
      const exportOptionsPath = join(iosProjectRootDir(projectDir), "build", "ExportOptions.plist");
      writeFileSync(
        exportOptionsPath,
        renderExportOptions({ method: exportMethod, signing, bundleId, xcodeVersion: await readXcodeVersion() }),
      );
      exported = await step(`Exporting .ipa (${exportMethod})`, (s) =>
        exportIpa(archivePath, exportOptionsPath, exportDir, signing, s.detail),
      );
      signed = true;
    }

    await step("Copying to the output folder", async () => {
      artifacts.push(await collectArtifact("ipa", exported, outputDir, `${baseName}${signed ? "" : "-unsigned"}.ipa`));
      const dsymZip = await zipArchiveDsyms(
        archivePath,
        join(outputDir, `${fileSafeAppName(environment.appName)}.dSYM.zip`),
      );
      if (dsymZip) artifacts.push(await collectArtifact("dsyms", dsymZip, outputDir));
    });
  }

  const { path: buildInfoPath, info } = writeBuildInfo(
    outputDir,
    {
      app: { name: environment.appName, id: bundleId },
      platform: "ios",
      environment: env,
      release: options.release,
      version: appVersion.version,
      buildNumber: appVersion.buildNumber,
      ...(simulator ? {} : { exportMethod }),
      signed,
      git: gitState(projectDir),
    },
    artifacts,
  );

  return {
    platform: "ios",
    appName: environment.appName,
    appId: bundleId,
    env,
    release: options.release,
    appVersion,
    target: simulator ? "simulator" : "device",
    artifacts,
    primary: artifacts[0],
    outputDir,
    buildInfoPath,
    buildInfo: info,
    warnings,
    webBuiltAt: webBuildTime(projectDir, config),
    syncedPlugins: context.syncedPlugins,
    unresolvedRegisteredPlugins: context.unresolvedRegisteredPlugins,
  };
}

/**
 * Builds the Android app. See {@link buildApp}.
 *
 * @returns The build, with `apkPath` and `sizeBytes` as earlier versions returned them.
 */
export async function build(projectDir: string, options: BuildOptions): Promise<BuildResult> {
  const [result] = await buildApp(projectDir, ["android"], options);
  return {
    ...result,
    apkPath: result.artifacts.find((a) => a.kind === "apk")?.path,
    sizeBytes: result.primary.sizeBytes,
  };
}

/**
 * Builds the iOS app. See {@link buildApp}.
 *
 * @returns The build, with `appPath` (the `.app` or `.ipa`) and `sizeBytes` as earlier versions returned them.
 */
export async function buildIosCommand(
  projectDir: string,
  options: IosBuildCommandOptions,
): Promise<IosBuildCommandResult> {
  const [result] = await buildApp(projectDir, ["ios"], options);
  return { ...result, appPath: result.primary.path, sizeBytes: result.primary.sizeBytes };
}

/** Size of a file or folder, re-exported for the summary. */
export { pathSize };
