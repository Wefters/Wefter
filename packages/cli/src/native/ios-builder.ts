import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { iosProjectRootDir, iosXcodeProjectPath } from "../config/project-paths.js";
import { appStoreConnectAuthArgs, iosSigningBuildSettings, signingSettingsFor } from "./signing-ios.js";
import type { ResolvedIosSigning } from "../config/signing-config.js";
import { versionBuildSettings } from "./inject-version.js";
import type { WefterConfig } from "../config/wefter-config-schema.js";
import { runProcess } from "../process/run-process.js";
import { diagnoseXcode } from "./ios-diagnostics.js";
import { createXcodeProgress } from "./build-progress.js";

/** The built `.app` bundle and its size. */
export interface IosBuildResult {
  appPath: string;
  sizeBytes: number;
}

/**
 * Options for {@link buildIos}. `simulator` is a simulator name or UDID to build for; `version` stamps the
 * app; `clean` removes earlier build products first.
 */
export interface IosBuildOptions {
  simulator?: string;
  onProgress?: (detail: string) => void;
  version?: { version: string; buildNumber: number };
  clean?: boolean;
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
    ...(options.clean ? ["clean"] : []),
    "build",
    ...(release ? iosSigningBuildSettings(config, projectDir) : []),
    ...(options.version ? versionBuildSettings(options.version) : []),
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

/**
 * Options for {@link archiveIos}.
 *
 * - `signing`: the resolved signing settings; `null` with `unsigned`.
 * - `unsigned`: archive without signing, for signing later.
 * - `archiveName`: file name of the archive, without `.xcarchive`.
 */
export interface IosArchiveOptions {
  signing: ResolvedIosSigning | null;
  unsigned?: boolean;
  version?: { version: string; buildNumber: number };
  clean?: boolean;
  archiveName: string;
  onProgress?: (detail: string) => void;
}

/** xcodebuild settings that turn code signing off, for an unsigned archive. */
const UNSIGNED_BUILD_SETTINGS = ["CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY="];

/** The archive xcodebuild made, and its size. */
export interface IosArchiveResult {
  archivePath: string;
  sizeBytes: number;
}

/**
 * Archives the app for iOS devices (`xcodebuild archive`, any iOS device) with the `Release-<Env>`
 * configuration, signed with `signing` (or unsigned), into `.wefter/native/ios/build/Archives`.
 *
 * @throws {ProcessFailure} When the archive fails, with the compiler or signing errors and hints.
 */
export async function archiveIos(
  projectDir: string,
  env: string,
  options: IosArchiveOptions,
): Promise<IosArchiveResult> {
  const configuration = `Release-${capitalize(env)}`;
  const projectRoot = iosProjectRootDir(projectDir);
  const archivesDir = join(projectRoot, "build", "Archives");
  const archivePath = join(archivesDir, `${options.archiveName}.xcarchive`);
  mkdirSync(archivesDir, { recursive: true });
  rmSync(archivePath, { recursive: true, force: true });

  const signingArgs = options.unsigned
    ? UNSIGNED_BUILD_SETTINGS
    : options.signing
      ? signingSettingsFor(options.signing)
      : [];

  const args = [
    "-project",
    iosXcodeProjectPath(projectDir),
    "-scheme",
    "WefterBridge",
    "-configuration",
    configuration,
    "-destination",
    "generic/platform=iOS",
    "-derivedDataPath",
    join(projectRoot, "build"),
    "-archivePath",
    archivePath,
    ...(options.unsigned ? [] : appStoreConnectAuthArgs(options.signing)),
    ...(options.clean ? ["clean"] : []),
    "archive",
    ...signingArgs,
    ...(options.version ? versionBuildSettings(options.version) : []),
  ];

  const progress = createXcodeProgress();
  await runProcess("xcodebuild", args, {
    cwd: projectRoot,
    tool: "Xcode",
    diagnose: diagnoseXcode,
    failureMessage: (code) => `xcodebuild archive failed with exit code ${code}`,
    onLine: (line) => {
      const detail = progress(line);
      if (detail) options.onProgress?.(detail);
    },
  });

  if (!existsSync(archivePath)) throw new Error(`No archive found at ${archivePath} after xcodebuild archive`);
  return { archivePath, sizeBytes: directorySize(archivePath) };
}

/**
 * Exports a signed `.ipa` from an archive (`xcodebuild -exportArchive`) with the given
 * `ExportOptions.plist`, into `exportDir`.
 *
 * @returns The path of the `.ipa`.
 * @throws {ProcessFailure} When the export fails, for example over a missing profile or certificate.
 */
export async function exportIpa(
  archivePath: string,
  exportOptionsPath: string,
  exportDir: string,
  signing: ResolvedIosSigning | null,
  onProgress?: (detail: string) => void,
): Promise<string> {
  rmSync(exportDir, { recursive: true, force: true });
  mkdirSync(exportDir, { recursive: true });
  await runProcess(
    "xcodebuild",
    [
      "-exportArchive",
      "-archivePath",
      archivePath,
      "-exportOptionsPlist",
      exportOptionsPath,
      "-exportPath",
      exportDir,
      ...appStoreConnectAuthArgs(signing),
    ],
    {
      tool: "Xcode",
      diagnose: diagnoseXcode,
      failureMessage: (code) => `xcodebuild -exportArchive failed with exit code ${code}`,
      onLine: (line) => {
        if (/Exported|Processing|Signing/i.test(line)) onProgress?.(line.trim().slice(0, 60));
      },
    },
  );
  const ipa = readdirSync(exportDir).find((f) => f.endsWith(".ipa"));
  if (!ipa) throw new Error(`No .ipa found in ${exportDir} after export`);
  return join(exportDir, ipa);
}

/**
 * Packs the app in an archive into an unsigned `.ipa` (a zip with the app under `Payload/`), for signing
 * later with your own tools.
 *
 * @returns The path of the `.ipa`.
 * @throws {Error} When the archive holds no app.
 */
export async function packageUnsignedIpa(archivePath: string, ipaPath: string): Promise<string> {
  const applicationsDir = join(archivePath, "Products", "Applications");
  const app = existsSync(applicationsDir) ? readdirSync(applicationsDir).find((f) => f.endsWith(".app")) : undefined;
  if (!app) throw new Error(`No app found in ${applicationsDir}`);

  const stagingDir = `${ipaPath}.staging`;
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(ipaPath, { force: true });
  mkdirSync(join(stagingDir, "Payload"), { recursive: true });
  try {
    await runProcess("ditto", [join(applicationsDir, app), join(stagingDir, "Payload", app)], { tool: "ditto" });
    await runProcess(
      "ditto",
      ["-c", "-k", "--norsrc", "--noextattr", "--keepParent", join(stagingDir, "Payload"), ipaPath],
      {
        tool: "ditto",
      },
    );
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
  return ipaPath;
}

/**
 * Zips the debug symbols (`dSYMs`) of an archive, which crash reporters need to show readable stack traces.
 *
 * @returns The path of the zip, or `null` when the archive has no symbols.
 */
export async function zipArchiveDsyms(archivePath: string, zipPath: string): Promise<string | null> {
  const dsymsDir = join(archivePath, "dSYMs");
  if (!existsSync(dsymsDir) || readdirSync(dsymsDir).length === 0) return null;
  rmSync(zipPath, { force: true });
  await runProcess("ditto", ["-c", "-k", "--norsrc", "--noextattr", "--keepParent", dsymsDir, zipPath], {
    tool: "ditto",
  });
  return zipPath;
}

/** Total size of a file or folder, in bytes. */
export function pathSize(path: string): number {
  return statSync(path).isDirectory() ? directorySize(path) : statSync(path).size;
}
