import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { iosProjectRootDir, iosXcodeProjectPath } from "../config/project-paths.js";
import { iosSigningBuildSettings } from "./signing-ios.js";
import type { WefterConfig } from "../config/wefter-config-schema.js";
import { runProcess } from "../process/run-process.js";
import { diagnoseXcode } from "./ios-diagnostics.js";
import { createXcodeProgress } from "./build-progress.js";

/** The built `.app` bundle and its size. */
export interface IosBuildResult {
  appPath: string;
  sizeBytes: number;
}

/** Options for {@link buildIos}. `simulator` is a simulator name or UDID to build for. */
export interface IosBuildOptions {
  simulator?: string;
  onProgress?: (detail: string) => void;
}

/** Upper-cases the first character, for configuration names. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A simulator UDID, as opposed to a simulator name. */
const SIMULATOR_UDID_PATTERN = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/**
 * Builds the app for the iOS simulator with xcodebuild, using the `<Debug|Release>-<Env>` configuration.
 * Release builds get the signing settings. Progress is reported through `onProgress`.
 *
 * @throws {ProcessFailure} When the build fails, with the compiler errors and hints.
 */
export async function buildIos(
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
    ? SIMULATOR_UDID_PATTERN.test(options.simulator)
      ? `platform=iOS Simulator,id=${options.simulator}`
      : `platform=iOS Simulator,name=${options.simulator}`
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

  const progress = createXcodeProgress();
  await runProcess("xcodebuild", args, {
    cwd: projectRoot,
    tool: "Xcode",
    diagnose: diagnoseXcode,
    failureMessage: (code) => `xcodebuild failed with exit code ${code}`,
    onLine: (line) => {
      const detail = progress(line);
      if (detail) options.onProgress?.(detail);
    },
  });

  const appPath = resolveAppPath(derivedDataPath, configuration);
  return { appPath, sizeBytes: directorySize(appPath) };
}

/** Finds the `.app` bundle xcodebuild produced. */
function resolveAppPath(derivedDataPath: string, configuration: string): string {
  const productsDir = join(derivedDataPath, "Build/Products", `${configuration}-iphonesimulator`);
  if (!existsSync(productsDir)) {
    throw new Error(`No build products directory found at ${productsDir} after build`);
  }
  const appBundle = readdirSync(productsDir).find((f) => f.endsWith(".app"));
  if (!appBundle) throw new Error(`No .app bundle found in ${productsDir} after build`);
  return join(productsDir, appBundle);
}

/** Total size of the files in a folder, recursively. */
function directorySize(dirPath: string): number {
  let total = 0;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = join(dirPath, entry.name);
    total += entry.isDirectory() ? directorySize(entryPath) : statSizeOf(entryPath);
  }
  return total;
}

/** Size of one file. */
function statSizeOf(filePath: string): number {
  return statSync(filePath).size;
}
