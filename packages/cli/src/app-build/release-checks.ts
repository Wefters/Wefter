/**
 * The checks a release build runs before compiling, split into errors (the build stops) and warnings (it
 * continues, unless `--strict`). `wefter doctor --release-readiness` runs the same checks without building.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { iosAppDir, iosBundleId, iosInfoPlistPath } from "../config/project-paths.js";
import { literalSecretSettings } from "../config/signing-config.js";
import { legacyConfigNotes, type IosExportMethod, type WefterConfig } from "../config/wefter-config-schema.js";
import { checkReleaseSecurity } from "../native/release-security-check.js";
import { checkReleaseSecurityIos } from "../native/release-security-check-ios.js";
import type { AppVersion } from "./app-version.js";
import { highestReleasedBuildNumber } from "./artifacts.js";
import { checkWebBuild, webBuildWarnings } from "./web-checks.js";

/** App ids the native templates ship with, which must never reach a store. */
export const TEMPLATE_APP_IDS = new Set(["dev.wefter.bridge", "dev.wefter.bridge.dev"]);

/** Errors stop a release build; warnings are shown and stop it only with `--strict`. */
export interface ReleaseCheckResult {
  errors: string[];
  warnings: string[];
}

/** What {@link runReleaseChecks} needs to know about the build. */
export interface ReleaseCheckInput {
  projectDir: string;
  config: WefterConfig;
  /** The config file as written, for messages about settings in an older shape. */
  rawConfig?: unknown;
  platform: "android" | "ios";
  env: string;
  appVersion: AppVersion;
  /** The build output folder, to compare the build number with earlier releases. */
  outputRoot?: string;
  /** This build's own output folder, which a rebuild of the same version replaces. */
  outputDir?: string;
  unsigned?: boolean;
  exportMethod?: IosExportMethod;
}

/** Other environments whose app id (or iOS bundle id) is the same as `env`'s. */
function environmentsSharingId(config: WefterConfig, env: string, platform: "android" | "ios"): string[] {
  const idOf = (name: string) => (platform === "ios" ? iosBundleId(config, name) : config.environments[name].appId);
  const own = idOf(env);
  return Object.keys(config.environments).filter((name) => name !== env && idOf(name) === own);
}

/** Whether `wefter.config.json` is tracked by git, so whatever it holds is pushed with the code. */
function configTrackedByGit(projectDir: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "wefter.config.json"], {
      cwd: projectDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** The App Store icon in the iOS project, or `null`. */
function iosStoreIconPath(projectDir: string): string | null {
  const iconSet = join(iosAppDir(projectDir), "Assets.xcassets", "AppIcon.appiconset");
  if (!existsSync(iconSet)) return null;
  const pngs = readdirSync(iconSet).filter((f) => f.endsWith(".png"));
  const preferred = pngs.find((f) => f.includes("1024")) ?? pngs[0];
  return preferred ? join(iconSet, preferred) : null;
}

/** iOS store checks: the App Store icon has no transparency, a privacy manifest exists, encryption is declared. */
async function iosStoreWarnings(projectDir: string, exportMethod: IosExportMethod | undefined): Promise<string[]> {
  const warnings: string[] = [];
  const icon = iosStoreIconPath(projectDir);
  if (!icon) {
    warnings.push('the app has no App Store icon; add "icon" to wefter.config.json and run `wefter sync`');
  } else {
    try {
      const { isOpaque } = await sharp(icon).stats();
      if (!isOpaque) warnings.push("the App Store icon has transparent pixels, which App Store Connect rejects");
    } catch {
      warnings.push(`could not read the App Store icon at ${icon}`);
    }
  }

  if (!existsSync(join(iosAppDir(projectDir), "PrivacyInfo.xcprivacy"))) {
    warnings.push("the app has no privacy manifest (PrivacyInfo.xcprivacy), which App Store Connect requires");
  }

  const plistPath = iosInfoPlistPath(projectDir);
  const declaresEncryption =
    existsSync(plistPath) && readFileSync(plistPath, "utf-8").includes("ITSAppUsesNonExemptEncryption");
  if (exportMethod === "app-store-connect" && !declaresEncryption) {
    warnings.push(
      'export compliance is not declared, so App Store Connect asks about encryption on every upload; set "build": { "ios": { "usesNonExemptEncryption": false } } if the app only uses HTTPS',
    );
  }
  return warnings;
}

/**
 * Runs every release check for one platform:
 *
 * - Errors: the platform's security check (dev server settings, debugging, signing unless `unsigned`),
 *   the template's app id, an app id shared with another environment, and a missing `index.html`.
 * - Warnings: source maps, development addresses and blocked outside resources in the web app, a build
 *   number not higher than an earlier release, passwords written into a config tracked by git, settings in an
 *   older shape, no version set, and (iOS) the App Store icon, privacy manifest and export compliance.
 */
export async function runReleaseChecks(input: ReleaseCheckInput): Promise<ReleaseCheckResult> {
  const { projectDir, config, platform, env, appVersion } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const requireSigning = !input.unsigned;

  const security =
    platform === "android"
      ? checkReleaseSecurity(projectDir, config, { requireSigning })
      : checkReleaseSecurityIos(projectDir, config, { requireSigning });
  errors.push(...security.issues);

  const environment = config.environments[env];
  if (environment) {
    const id = platform === "ios" ? iosBundleId(config, env) : environment.appId;
    if (TEMPLATE_APP_IDS.has(id)) {
      errors.push(
        `the "${env}" environment still uses the template's ${platform === "ios" ? "bundle id" : "app id"} ${id}; set your own in wefter.config.json`,
      );
    }
    const sharing = environmentsSharingId(config, env, platform);
    if (sharing.length > 0) {
      errors.push(
        `the "${env}" environment has the same ${platform === "ios" ? "bundle id" : "app id"} (${id}) as ${sharing.map((s) => `"${s}"`).join(", ")}; each environment must be a separate app`,
      );
    }
  }

  const web = checkWebBuild(resolve(projectDir, config.webDir));
  if (web.indexHtmlMissing) {
    errors.push(`no index.html in ${config.webDir}; build the web app first (for example in "wefter:build:before")`);
  }
  warnings.push(...webBuildWarnings(web, config.webDir));

  if (input.outputRoot) {
    const previous = highestReleasedBuildNumber(input.outputRoot, platform, env, input.outputDir);
    if (previous && appVersion.buildNumber <= previous.buildNumber) {
      warnings.push(
        `build number ${appVersion.buildNumber} is not higher than the earlier release ${previous.version} (${previous.buildNumber}); the stores reject a build number they have seen, so raise it with --build-number or "buildNumber"`,
      );
    }
  }

  const literalSecrets = literalSecretSettings(config);
  if (literalSecrets.length > 0 && configTrackedByGit(projectDir)) {
    warnings.push(
      `${literalSecrets.join(" and ")} ${literalSecrets.length > 1 ? "are" : "is"} written into wefter.config.json, which git tracks; use "\${WEFTER_KEYSTORE_PASSWORD}" and keep the value in .env or your CI secrets`,
    );
  }

  for (const note of legacyConfigNotes(input.rawConfig)) warnings.push(`wefter.config.json: ${note}`);

  if (appVersion.versionSource === "default") {
    warnings.push(`no app version is set, so ${appVersion.version} is used; set "version" in wefter.config.json`);
  }

  if (platform === "ios") warnings.push(...(await iosStoreWarnings(projectDir, input.exportMethod)));

  return { errors, warnings };
}
