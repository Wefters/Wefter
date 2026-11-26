import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  androidAppModuleDir,
  androidBuildGradlePath,
  androidDebugNetworkSecurityConfigPath,
} from "../config/project-paths.js";
import type { WefterConfig } from "../config/wefter-config-schema.js";

/** Result of {@link checkReleaseSecurity}. */
export interface ReleaseSecurityResult {
  passed: boolean;
  issues: string[];
}

/** Files under `dir` (recursively) whose name matches `predicate`. */
function findFiles(dir: string, predicate: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findFiles(entryPath, predicate));
    } else if (predicate(entry.name)) {
      found.push(entryPath);
    }
  }
  return found;
}

/** The release `DEV_SERVER_URL` value in `build.gradle.kts`, found by its marker comment. */
function readReleaseDevServerUrlField(buildGradlePath: string): string | null {
  if (!existsSync(buildGradlePath)) return null;
  const contents = readFileSync(buildGradlePath, "utf-8");
  const match = contents.match(/"DEV_SERVER_URL",\s*"\\"(.*?)\\""\)\s*\/\/ always empty in release/);
  return match ? match[1] : null;
}

/**
 * Checks that an Android release build is safe to ship: no release dev server URL, no unconditional
 * web view debugging, the debug-only network config in place, and a signing keystore that exists.
 */
export function checkReleaseSecurity(projectDir: string, config: WefterConfig): ReleaseSecurityResult {
  const issues: string[] = [];

  const buildGradlePath = androidBuildGradlePath(projectDir);
  const releaseDevServerUrl = readReleaseDevServerUrlField(buildGradlePath);
  if (releaseDevServerUrl) {
    issues.push(
      `The release buildType's DEV_SERVER_URL is not empty in build.gradle.kts — it should never be set; run \`wefter sync\` to regenerate`,
    );
  }

  const kotlinFiles = findFiles(join(androidAppModuleDir(projectDir), "src/main"), (name) => name.endsWith(".kt"));
  const hasHardcodedDebugging = kotlinFiles.some((path) =>
    readFileSync(path, "utf-8").includes("setWebContentsDebuggingEnabled(true)"),
  );
  if (hasHardcodedDebugging) {
    issues.push("Hardcoded setWebContentsDebuggingEnabled(true) found — must be gated by BuildConfig.DEBUG");
  }

  const debugNetworkConfigPath = androidDebugNetworkSecurityConfigPath(projectDir);
  if (!existsSync(debugNetworkConfigPath)) {
    issues.push(`Debug network security config missing or misplaced (expected at ${debugNetworkConfigPath})`);
  }

  if (!config.signing) {
    issues.push("No release signing config found in wefter.config.json");
  } else {
    const keystorePath = resolve(projectDir, config.signing.keystorePath);
    if (!existsSync(keystorePath) || !statSync(keystorePath).isFile()) {
      issues.push(`Signing keystore not found at ${keystorePath}`);
    }
  }

  return { passed: issues.length === 0, issues };
}
