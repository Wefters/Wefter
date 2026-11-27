import { join } from "node:path";
import { existsSync, readdirSync, renameSync, statSync } from "node:fs";
import { androidProjectRootDir } from "../config/project-paths.js";
import { buildSigningEnv } from "./signing.js";
import type { AndroidFormat, WefterConfig } from "../config/wefter-config-schema.js";
import { runProcess } from "../process/run-process.js";
import { diagnoseGradle } from "./android-diagnostics.js";
import { createGradleProgress } from "./build-progress.js";

/**
 * What Gradle built: the APK and/or App Bundle (named after the app, see {@link artifactFileName}), and for
 * release builds the R8 mapping and native debug symbols when Gradle wrote them. `sizeBytes` is the size of
 * the APK, or of the App Bundle when no APK was built.
 */
export interface AndroidBuildResult {
  apkPath?: string;
  aabPath?: string;
  mappingPath?: string;
  nativeSymbolsPath?: string;
  sizeBytes: number;
}

/** Upper-cases the first character, for Gradle task names. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Options for {@link buildAndroid}.
 *
 * - `format`: `apk` (default), `aab` or `both`.
 * - `clean`: run Gradle's `clean` first.
 * - `unsigned`: build a release without signing it, for signing later.
 * - `version`: shown in the output file names, such as `1.4.0-42`.
 */
export interface AndroidBuildOptions {
  onProgress?: (detail: string) => void;
  format?: AndroidFormat;
  clean?: boolean;
  unsigned?: boolean;
  version?: { version: string; buildNumber: number };
}

/** The Gradle tasks that build `format` for one environment and build type. */
export function gradleTasks(env: string, release: boolean, format: AndroidFormat): string[] {
  const variant = `${capitalize(env)}${release ? "Release" : "Debug"}`;
  const tasks: string[] = [];
  if (format === "apk" || format === "both") tasks.push(`assemble${variant}`);
  if (format === "aab" || format === "both") tasks.push(`bundle${variant}`);
  return tasks;
}

/**
 * Builds the app for an environment with Gradle: an APK (`assemble<Env><Type>`), an App Bundle
 * (`bundle<Env><Type>`), or both in one run. Release builds get the signing secrets in their environment,
 * unless `unsigned`. Progress is reported through `onProgress`.
 *
 * @throws {ProcessFailure} When Gradle fails, with the compiler errors and hints.
 */
export async function buildAndroid(
  projectDir: string,
  config: WefterConfig,
  env: string,
  release: boolean,
  options: AndroidBuildOptions = {},
): Promise<AndroidBuildResult> {
  const format = options.format ?? "apk";
  const buildType = release ? "release" : "debug";
  const variant = `${env}${capitalize(buildType)}`;
  const projectRoot = androidProjectRootDir(projectDir);
  const signingEnv = release && !options.unsigned ? buildSigningEnv(projectDir, config) : {};
  const tasks = [...(options.clean ? ["clean"] : []), ...gradleTasks(env, release, format)];

  const progress = createGradleProgress(capitalize(variant));
  await runProcess("./gradlew", [...tasks, "--console=plain"], {
    cwd: projectRoot,
    env: { ...withoutSigningVariables(process.env), ...signingEnv },
    tool: "Gradle",
    diagnose: diagnoseGradle,
    failureMessage: (code) => `Gradle build failed with exit code ${code}`,
    onLine: (line) => {
      const detail = progress(line);
      if (detail) options.onProgress?.(detail);
    },
  });

  const appName = config.environments[env]?.appName ?? "app";
  const naming = { appName, env, release, version: options.version };
  const outputs = join(projectRoot, "app/build/outputs");
  const result: AndroidBuildResult = { sizeBytes: 0 };

  if (format === "apk" || format === "both") {
    result.apkPath = nameBuiltFile(join(outputs, "apk", env, buildType), `app-${env}-${buildType}`, "apk", naming);
  }
  if (format === "aab" || format === "both") {
    result.aabPath = nameBuiltFile(join(outputs, "bundle", variant), `app-${env}-${buildType}`, "aab", naming);
  }

  if (release) {
    const mappingPath = join(outputs, "mapping", variant, "mapping.txt");
    if (existsSync(mappingPath)) result.mappingPath = mappingPath;
    const symbolsPath = join(outputs, "native-debug-symbols", variant, "native-debug-symbols.zip");
    if (existsSync(symbolsPath)) result.nativeSymbolsPath = symbolsPath;
  }

  result.sizeBytes = statSync((result.apkPath ?? result.aabPath)!).size;
  return result;
}

/**
 * A copy of the environment without the signing variables, so an unsigned or debug build never picks up a
 * keystore set in the shell; a signed build gets them back from its resolved settings.
 */
function withoutSigningVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const name of ["WEFTER_KEYSTORE_PATH", "WEFTER_KEY_ALIAS", "WEFTER_KEYSTORE_PASSWORD", "WEFTER_KEY_PASSWORD"]) {
    delete copy[name];
  }
  return copy;
}

/** What a built file's name is made of. */
export interface ArtifactNaming {
  appName: string;
  env: string;
  release: boolean;
  version?: { version: string; buildNumber: number };
}

/** The app name as a file name part: spaces become dashes, other unsafe characters are dropped. */
export function fileSafeAppName(appName: string): string {
  return (
    appName
      .replace(/[^A-Za-z0-9._\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-") || "app"
  );
}

/**
 * The file name a built APK or App Bundle gets: the app name with spaces as dashes, the environment, the
 * version when known, and the build type, such as `Wefter-Demo-production-1.4.0-42-release.aab`. An
 * unsigned file ends in `-unsigned`.
 */
export function artifactFileName(naming: ArtifactNaming, extension: "apk" | "aab", unsigned = false): string {
  const version = naming.version ? `-${naming.version.version}-${naming.version.buildNumber}` : "";
  return `${fileSafeAppName(naming.appName)}-${naming.env}${version}-${naming.release ? "release" : "debug"}${unsigned ? "-unsigned" : ""}.${extension}`;
}

/** {@link artifactFileName} for an APK without a version, as earlier versions named it. */
export function apkFileName(appName: string, env: string, release: boolean, unsigned = false): string {
  return artifactFileName({ appName, env, release }, "apk", unsigned);
}

/**
 * Renames the file Gradle wrote in `outDir` (`<gradleName>.<extension>`, or `-unsigned`) to
 * {@link artifactFileName}, replacing one from an earlier build.
 *
 * @returns The path of the renamed file.
 * @throws {Error} When Gradle wrote no such file.
 */
export function nameBuiltFile(
  outDir: string,
  gradleName: string,
  extension: "apk" | "aab",
  naming: ArtifactNaming,
): string {
  const files = existsSync(outDir) ? readdirSync(outDir) : [];
  const built = [`${gradleName}.${extension}`, `${gradleName}-unsigned.${extension}`].find((f) => files.includes(f));
  if (!built) throw new Error(`No ${extension.toUpperCase()} found in ${outDir} after build`);
  const target = join(outDir, artifactFileName(naming, extension, built.endsWith(`-unsigned.${extension}`)));
  renameSync(join(outDir, built), target);
  return target;
}

/** {@link nameBuiltFile} for an APK without a version, as earlier versions named it. */
export function nameBuiltApk(outDir: string, appName: string, env: string, release: boolean): string {
  return nameBuiltFile(outDir, `app-${env}-${release ? "release" : "debug"}`, "apk", { appName, env, release });
}
