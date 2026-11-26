import { join } from "node:path";
import { readdirSync, renameSync, statSync } from "node:fs";
import { androidProjectRootDir } from "../config/project-paths.js";
import { buildSigningEnv } from "./signing.js";
import type { WefterConfig } from "../config/wefter-config-schema.js";
import { runProcess } from "../process/run-process.js";
import { diagnoseGradle } from "./android-diagnostics.js";
import { createGradleProgress } from "./build-progress.js";

/** The built APK and its size. */
export interface AndroidBuildResult {
  apkPath: string;
  sizeBytes: number;
}

/** Upper-cases the first character, for Gradle task names. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Options for {@link buildAndroid}. */
export interface AndroidBuildOptions {
  onProgress?: (detail: string) => void;
}

/**
 * Builds the APK for an environment with Gradle (`assemble<Env><Debug|Release>`). Release builds get the
 * signing secrets in their environment. Progress is reported through `onProgress`. The APK is named after
 * the app, such as `Wefter-Demo-production-release.apk`; see {@link apkFileName}.
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
  const buildType = release ? "Release" : "Debug";
  const task = `assemble${capitalize(env)}${buildType}`;
  const projectRoot = androidProjectRootDir(projectDir);
  const signingEnv = release ? buildSigningEnv(projectDir, config) : {};

  const progress = createGradleProgress(`${capitalize(env)}${buildType}`);
  await runProcess("./gradlew", [task, "--console=plain"], {
    cwd: projectRoot,
    env: { ...process.env, ...signingEnv },
    tool: "Gradle",
    diagnose: diagnoseGradle,
    failureMessage: (code) => `Gradle build failed with exit code ${code}`,
    onLine: (line) => {
      const detail = progress(line);
      if (detail) options.onProgress?.(detail);
    },
  });

  const outDir = join(projectRoot, "app/build/outputs/apk", env, release ? "release" : "debug");
  const apkPath = nameBuiltApk(outDir, config.environments[env]?.appName ?? "app", env, release);
  return { apkPath, sizeBytes: statSync(apkPath).size };
}

/**
 * The file name a built APK gets: the app name with spaces as dashes, then the environment and build type,
 * such as `Wefter-Demo-production-release.apk`. An unsigned APK ends in `-unsigned.apk`.
 */
export function apkFileName(appName: string, env: string, release: boolean, unsigned = false): string {
  const name =
    appName
      .replace(/[^A-Za-z0-9._\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-") || "app";
  return `${name}-${env}-${release ? "release" : "debug"}${unsigned ? "-unsigned" : ""}.apk`;
}

/**
 * Renames the APK Gradle wrote in `outDir` (`app-<env>-<buildType>.apk`) to {@link apkFileName}, replacing
 * the one from an earlier build.
 *
 * @returns The path of the renamed APK.
 * @throws {Error} When Gradle wrote no APK.
 */
export function nameBuiltApk(outDir: string, appName: string, env: string, release: boolean): string {
  const gradleName = `app-${env}-${release ? "release" : "debug"}`;
  const gradleApk = [`${gradleName}.apk`, `${gradleName}-unsigned.apk`].find((f) => readdirSync(outDir).includes(f));
  if (!gradleApk) throw new Error(`No APK found in ${outDir} after build`);
  const apkPath = join(outDir, apkFileName(appName, env, release, gradleApk.endsWith("-unsigned.apk")));
  renameSync(join(outDir, gradleApk), apkPath);
  return apkPath;
}
