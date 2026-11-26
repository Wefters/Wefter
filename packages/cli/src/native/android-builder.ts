import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";
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
 * signing secrets in their environment. Progress is reported through `onProgress`.
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

  const apkPath = resolveApkPath(projectRoot, env, release);
  return { apkPath, sizeBytes: statSync(apkPath).size };
}

/** Finds the APK Gradle wrote for this variant. */
function resolveApkPath(projectRoot: string, env: string, release: boolean): string {
  const buildType = release ? "release" : "debug";
  const outDir = join(projectRoot, "app/build/outputs/apk", env, buildType);
  const apkFile = readdirSync(outDir).find((f) => f.endsWith(".apk"));
  if (!apkFile) throw new Error(`No APK found in ${outDir} after build`);
  return join(outDir, apkFile);
}
