import { existsSync, readFileSync } from "node:fs";
import { iosAppDir, iosBuildConfigPath, iosInfoPlistPath } from "../config/project-paths.js";
import type { WefterConfig } from "../config/wefter-config-schema.js";

/** Result of {@link checkReleaseSecurityIos}. */
export interface ReleaseSecurityResultIos {
  passed: boolean;
  issues: string[];
}

/** The release `devServerURL` value in `BuildConfig.swift`, found by its marker comment. */
function readReleaseDevServerUrl(buildConfigPath: string): string | null {
  if (!existsSync(buildConfigPath)) return null;
  const contents = readFileSync(buildConfigPath, "utf-8");
  const match = contents.match(/static let devServerURL = "(.*?)" \/\/ WEFTER always empty in release/);
  return match ? match[1] : null;
}

/** How many ATS exception domains `--watch` left in `Info.plist`. */
function ansExceptionDomainCount(infoPlistPath: string): number {
  if (!existsSync(infoPlistPath)) return 0;
  const contents = readFileSync(infoPlistPath, "utf-8");
  const blockMatch = contents.match(/<!-- WEFTER-ATS-EXCEPTIONS-START -->([\s\S]*?)<!-- WEFTER-ATS-EXCEPTIONS-END -->/);
  if (!blockMatch) return 0;
  return [...blockMatch[1].matchAll(/<key>([\d.]+)<\/key>/g)].length;
}

/**
 * Checks that an iOS release build cannot reach a dev server: no release dev server URL, no ATS exceptions,
 * an existing native project and a signing config.
 */
export function checkReleaseSecurityIos(projectDir: string, config: WefterConfig): ReleaseSecurityResultIos {
  const issues: string[] = [];

  const buildConfigPath = iosBuildConfigPath(projectDir);
  const releaseDevServerUrl = readReleaseDevServerUrl(buildConfigPath);
  if (releaseDevServerUrl) {
    issues.push(
      "The release branch's DEV_SERVER_URL is not empty in BuildConfig.swift — it should never be set; run `wefter sync` to regenerate",
    );
  }

  const infoPlistPath = iosInfoPlistPath(projectDir);
  const atsExceptionCount = ansExceptionDomainCount(infoPlistPath);
  if (atsExceptionCount > 0) {
    issues.push(
      `${atsExceptionCount} ATS exception domain(s) still present in Info.plist — these are added for --watch's LAN dev server and must be cleared before a release build; run \`wefter sync\` to reset them`,
    );
  }

  if (!existsSync(iosAppDir(projectDir))) {
    issues.push(`iOS native project not found at ${iosAppDir(projectDir)} — run \`wefter sync\` first`);
  }

  if (!config.iosSigning) {
    issues.push('No iOS release signing config found in wefter.config.json (missing "iosSigning")');
  }

  return { passed: issues.length === 0, issues };
}
