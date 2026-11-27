import { existsSync, readFileSync } from "node:fs";
import { iosAppDir, iosBuildConfigPath, iosInfoPlistPath } from "../config/project-paths.js";
import type { WefterConfig } from "../config/wefter-config-schema.js";
import { resolveIosSigning } from "../config/signing-config.js";

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
 * an existing native project and complete signing settings.
 */
export function checkReleaseSecurityIos(
  projectDir: string,
  config: WefterConfig,
  options: { requireSigning?: boolean } = {},
): ReleaseSecurityResultIos {
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

  if (options.requireSigning ?? true) {
    issues.push(...iosSigningIssues(projectDir, config));
  }

  return { passed: issues.length === 0, issues };
}

/** What is wrong with the iOS signing settings. Empty when signing is ready. */
export function iosSigningIssues(projectDir: string, config: WefterConfig): string[] {
  const signing = resolveIosSigning(projectDir, config);
  if (!signing) {
    return ['No iOS release signing config found in wefter.config.json (add "signing": { "ios": { "teamId": … } })'];
  }
  const issues = [...signing.problems];
  if (signing.appStoreConnect && !existsSync(signing.appStoreConnect.keyPath)) {
    issues.push(`App Store Connect API key not found at ${signing.appStoreConnect.keyPath}`);
  }
  return issues;
}
