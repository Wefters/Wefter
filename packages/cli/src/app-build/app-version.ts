/**
 * The app version (`1.4.0`) and build number (`42`) a build is stamped with. The version is what users see
 * in the stores; the build number tells uploads of the same version apart and must go up with every upload.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION_PATTERN, MAX_BUILD_NUMBER, type WefterConfig } from "../config/wefter-config-schema.js";

/** Environment variables that override the config, for CI (for example the pipeline's run number). */
export const APP_VERSION_ENV = "WEFTER_APP_VERSION";
export const BUILD_NUMBER_ENV = "WEFTER_BUILD_NUMBER";

/** Version used when neither the config nor `package.json` gives one. */
const FALLBACK_VERSION = "1.0.0";

/** Where a value came from, for the build summary. */
export type VersionSource = "option" | "environment" | "config" | "package.json" | "default";

/** The version and build number of a build. */
export interface AppVersion {
  version: string;
  buildNumber: number;
  versionSource: VersionSource;
  buildNumberSource: VersionSource;
}

/** Values given on the command line (`--app-version`, `--build-number`), which win over everything else. */
export interface AppVersionOverrides {
  appVersion?: string;
  buildNumber?: string | number;
}

/**
 * Checks a version: three whole numbers such as `1.4.0`, as the App Store requires.
 *
 * @throws {Error} Naming `origin` when it is not.
 */
export function validateAppVersion(version: string, origin: string): string {
  const trimmed = version.trim();
  if (!APP_VERSION_PATTERN.test(trimmed)) {
    throw new Error(`${origin} "${version}" is not a valid app version: use three numbers such as 1.4.0`);
  }
  return trimmed;
}

/**
 * Checks a build number: a whole number from 1 to 2,100,000,000 (Google Play's largest `versionCode`).
 *
 * @throws {Error} Naming `origin` when it is not.
 */
export function validateBuildNumber(value: string | number, origin: string): number {
  const text = String(value).trim();
  const parsed = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BUILD_NUMBER) {
    throw new Error(
      `${origin} "${value}" is not a valid build number: use a whole number from 1 to ${MAX_BUILD_NUMBER.toLocaleString("en-US")}`,
    );
  }
  return parsed;
}

/** The `version` of the project's `package.json`, cut to its `X.Y.Z` part (`1.4.0-beta.2` gives `1.4.0`). */
function packageJsonVersion(projectDir: string): string | undefined {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const version = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    if (typeof version !== "string") return undefined;
    return /^(\d+\.\d+\.\d+)/.exec(version.trim())?.[1];
  } catch {
    return undefined;
  }
}

/**
 * The version and build number for a build. Each is taken from, in order: the command line, the
 * `WEFTER_APP_VERSION` / `WEFTER_BUILD_NUMBER` variables, `version` / `buildNumber` in the config, and
 * finally `package.json`'s version (or `1.0.0`) and build number `1`.
 *
 * @throws {Error} When a given value is not a valid version or build number.
 */
export function resolveAppVersion(
  projectDir: string,
  config: WefterConfig,
  overrides: AppVersionOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): AppVersion {
  let version: string;
  let versionSource: VersionSource;
  if (overrides.appVersion !== undefined) {
    version = validateAppVersion(overrides.appVersion, "--app-version");
    versionSource = "option";
  } else if (env[APP_VERSION_ENV]) {
    version = validateAppVersion(env[APP_VERSION_ENV]!, APP_VERSION_ENV);
    versionSource = "environment";
  } else if (config.version) {
    version = config.version;
    versionSource = "config";
  } else {
    const fromPackage = packageJsonVersion(projectDir);
    version = fromPackage ?? FALLBACK_VERSION;
    versionSource = fromPackage ? "package.json" : "default";
  }

  let buildNumber: number;
  let buildNumberSource: VersionSource;
  if (overrides.buildNumber !== undefined) {
    buildNumber = validateBuildNumber(overrides.buildNumber, "--build-number");
    buildNumberSource = "option";
  } else if (env[BUILD_NUMBER_ENV]) {
    buildNumber = validateBuildNumber(env[BUILD_NUMBER_ENV]!, BUILD_NUMBER_ENV);
    buildNumberSource = "environment";
  } else if (config.buildNumber !== undefined) {
    buildNumber = config.buildNumber;
    buildNumberSource = "config";
  } else {
    buildNumber = 1;
    buildNumberSource = "default";
  }

  return { version, buildNumber, versionSource, buildNumberSource };
}

/** `1.4.0 (42)`, as the stores show it. */
export function formatAppVersion(appVersion: Pick<AppVersion, "version" | "buildNumber">): string {
  return `${appVersion.version} (${appVersion.buildNumber})`;
}
