import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { iosProjectRootDir, iosXcodeProjectPath } from "../config/project-paths.js";
import { iosSigningBuildSettings } from "./signing-ios.js";
import type { WefterConfig } from "../config/wefter-config-schema.js";

export interface IosBuildResult {
  appPath: string;
  sizeBytes: number;
}

export interface IosBuildOptions {
  
  simulator?: string;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildIos(
  projectDir: string,
  config: WefterConfig,
  env: string,
  release: boolean,
  options: IosBuildOptions = {},
): Promise<IosBuildResult> {
  const buildType = release ? "Release" : "Debug";
  const configuration = `${buildType}-${capitalize(env)}`;
  const projectRoot = iosProjectRootDir(projectDir);
  const xcodeProjectPath = iosXcodeProjectPath(projectDir);
  const derivedDataPath = join(projectRoot, "build");

  const destination = options.simulator
    ? `platform=iOS Simulator,name=${options.simulator}`
    : "generic/platform=iOS Simulator";

  const args = [
    "-project",
    xcodeProjectPath,
    "-scheme",
    "WefterBridge",
    "-configuration",
    configuration,
    "-destination",
    destination,
    "-derivedDataPath",
    derivedDataPath,
    "build",
    ...(release ? iosSigningBuildSettings(config) : []),
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("xcodebuild", args, { cwd: projectRoot, stdio: "inherit" });

    proc.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`xcodebuild failed with exit code ${code}`));
        return;
      }
      try {
        const appPath = resolveAppPath(derivedDataPath, configuration);
        resolve({ appPath, sizeBytes: directorySize(appPath) });
      } catch (err) {
        reject(err);
      }
    });

    proc.on("error", reject);
  });
}

function resolveAppPath(derivedDataPath: string, configuration: string): string {
  const productsDir = join(derivedDataPath, "Build/Products", `${configuration}-iphonesimulator`);
  if (!existsSync(productsDir)) {
    throw new Error(`No build products directory found at ${productsDir} after build`);
  }
  const appBundle = readdirSync(productsDir).find((f) => f.endsWith(".app"));
  if (!appBundle) throw new Error(`No .app bundle found in ${productsDir} after build`);
  return join(productsDir, appBundle);
}

function directorySize(dirPath: string): number {
  let total = 0;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = join(dirPath, entry.name);
    total += entry.isDirectory() ? directorySize(entryPath) : statSizeOf(entryPath);
  }
  return total;
}

function statSizeOf(filePath: string): number {
  return statSync(filePath).size;
}
