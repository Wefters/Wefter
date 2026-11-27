import { loadWefterConfig, readRawConfig } from "../config/project-paths.js";
import { usesVerifiedDomains } from "../config/deep-links.js";
import { checkDeepLinkDomains } from "../commands/deep-links.js";
import { resolveAppVersion, type AppVersion } from "../app-build/app-version.js";
import { buildOutputDir, resolveOutputRoot } from "../app-build/artifacts.js";
import { runReleaseChecks } from "../app-build/release-checks.js";
import type { CheckResult } from "./checks.js";

/** Options for {@link runReleaseReadinessChecks}. */
export interface ReleaseReadinessOptions {
  /** The environment a release would build; `production` by default, as `wefter build --release`. */
  env?: string;
  /** The platforms to check; both by default. */
  platforms?: ("android" | "ios")[];
}

/**
 * Checks behind `wefter doctor --release-readiness`: the same checks `wefter build --release` runs before
 * compiling, for each platform (an error fails, a warning is reported without failing), the version and
 * build number, and, when the app opens verified `https` links, that every domain serves verification files
 * listing it (see `wefter deep-links check`).
 */
export async function runReleaseReadinessChecks(
  projectDir: string,
  options: ReleaseReadinessOptions = {},
): Promise<CheckResult[]> {
  const config = loadWefterConfig(projectDir);
  const rawConfig = readRawConfig(projectDir);
  const results: CheckResult[] = [];
  const env = options.env ?? "production";

  if (!config.environments[env]) {
    results.push({
      name: `"${env}" environment`,
      passed: false,
      fix: `release builds use the "${env}" environment; add it to "environments" in wefter.config.json`,
    });
    return results;
  }

  let appVersion: AppVersion;
  try {
    appVersion = resolveAppVersion(projectDir, config);
    results.push({ name: "App version", passed: true, detail: `${appVersion.version} (${appVersion.buildNumber})` });
  } catch (error) {
    results.push({ name: "App version", passed: false, fix: error instanceof Error ? error.message : String(error) });
    return results;
  }

  let outputRoot: string | undefined;
  try {
    outputRoot = resolveOutputRoot(projectDir, config.build.output, config.webDir);
  } catch (error) {
    results.push({ name: "Output folder", passed: false, fix: error instanceof Error ? error.message : String(error) });
  }

  const platforms = options.platforms ?? (["android", "ios"] as const);
  const warningsByPlatform = new Map<string, string[]>();
  for (const platform of platforms) {
    const label = platform === "ios" ? "iOS" : "Android";
    const checks = await runReleaseChecks({
      projectDir,
      config,
      rawConfig,
      platform,
      env,
      appVersion,
      outputRoot,
      outputDir: outputRoot ? buildOutputDir(outputRoot, platform, env, appVersion) : undefined,
      exportMethod: platform === "ios" ? config.build.ios.exportMethod : undefined,
    });
    if (checks.errors.length === 0) {
      results.push({ name: `${label} release checks`, passed: true });
    }
    for (const error of checks.errors) {
      results.push({ name: `${label}: ${error}`, passed: false });
    }
    warningsByPlatform.set(label, checks.warnings);
  }

  const labels = [...warningsByPlatform.keys()];
  const shared = (warningsByPlatform.get(labels[0]) ?? []).filter(
    (warning) => labels.length > 1 && labels.every((label) => warningsByPlatform.get(label)!.includes(warning)),
  );
  for (const warning of shared) results.push({ name: warning, passed: true, warning: true });
  for (const [label, warnings] of warningsByPlatform) {
    for (const warning of warnings.filter((w) => !shared.includes(w))) {
      results.push({ name: `${label}: ${warning}`, passed: true, warning: true });
    }
  }

  if (usesVerifiedDomains(config)) {
    try {
      results.push(...(await checkDeepLinkDomains(projectDir)));
    } catch (error) {
      results.push({
        name: "Deep link domains",
        passed: false,
        fix: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
