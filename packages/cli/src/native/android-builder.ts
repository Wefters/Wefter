import { spawn } from "node:child_process";
import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { androidProjectRootDir } from "../config/project-paths.js";
import { buildSigningEnv } from "./signing.js";
import type { WefterConfig } from "../config/wefter-config-schema.js";

export interface AndroidBuildResult {
  apkPath: string;
  sizeBytes: number;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildAndroid(
  projectDir: string,
  config: WefterConfig,
  env: string,
  release: boolean
): Promise<AndroidBuildResult> {
  const buildType = release ? "Release" : "Debug";
  const task = `assemble${capitalize(env)}${buildType}`;
  const projectRoot = androidProjectRootDir(projectDir);
  const signingEnv = release ? buildSigningEnv(projectDir, config) : {};

  return new Promise((resolve, reject) => {
    const proc = spawn("./gradlew", [task], {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env, ...signingEnv },
    });

    proc.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Gradle build failed with exit code ${code}`));
        return;
      }
      try {
        const apkPath = resolveApkPath(projectRoot, env, release);
        resolve({ apkPath, sizeBytes: statSync(apkPath).size });
      } catch (err) {
        reject(err);
      }
    });

    proc.on("error", reject);
  });
}

function resolveApkPath(projectRoot: string, env: string, release: boolean): string {
  const buildType = release ? "release" : "debug";
  const outDir = join(projectRoot, "app/build/outputs/apk", env, buildType);
  const apkFile = readdirSync(outDir).find((f) => f.endsWith(".apk"));
  if (!apkFile) throw new Error(`No APK found in ${outDir} after build`);
  return join(outDir, apkFile);
}
