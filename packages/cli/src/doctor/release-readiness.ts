import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadWefterConfig } from "../config/project-paths.js";
import { checkReleaseSecurity } from "../native/release-security-check.js";
import { checkReleaseSecurityIos } from "../native/release-security-check-ios.js";
import type { CheckResult } from "./checks.js";

export async function runReleaseReadinessChecks(projectDir: string): Promise<CheckResult[]> {
  const config = loadWefterConfig(projectDir);
  const results: CheckResult[] = [];

  const security = checkReleaseSecurity(projectDir, config);
  results.push({
    name: "Release security lint",
    passed: security.passed,
    detail: security.passed ? undefined : security.issues.join("; "),
    fix: security.passed ? undefined : "run `wefter sync` and address each issue listed above",
  });

  if (!config.signing) {
    results.push({
      name: "Signing config",
      passed: false,
      fix: 'add a "signing" block to wefter.config.json (keystorePath, keyAlias)',
    });
  } else {
    const keystorePath = resolve(projectDir, config.signing.keystorePath);
    const keystoreExists = existsSync(keystorePath);
    results.push({
      name: "Signing keystore present",
      passed: keystoreExists,
      detail: keystoreExists ? keystorePath : undefined,
      fix: keystoreExists ? undefined : `keystore not found at ${keystorePath}`,
    });

    results.push({
      name: "WEFTER_KEYSTORE_PASSWORD set",
      passed: !!process.env.WEFTER_KEYSTORE_PASSWORD,
      fix: process.env.WEFTER_KEYSTORE_PASSWORD
        ? undefined
        : "set WEFTER_KEYSTORE_PASSWORD in .env (gitignored) before running a release build",
    });
  }

  const securityIos = checkReleaseSecurityIos(projectDir, config);
  results.push({
    name: "iOS release security lint",
    passed: securityIos.passed,
    detail: securityIos.passed ? undefined : securityIos.issues.join("; "),
    fix: securityIos.passed ? undefined : "run `wefter sync` and address each issue listed above",
  });

  if (!config.iosSigning) {
    results.push({
      name: "iOS signing config",
      passed: false,
      fix: 'add an "iosSigning" block to wefter.config.json (teamId)',
    });
  } else {
    results.push({
      name: "WEFTER_IOS_SIGNING_IDENTITY set",
      passed: !!process.env.WEFTER_IOS_SIGNING_IDENTITY,
      fix: process.env.WEFTER_IOS_SIGNING_IDENTITY
        ? undefined
        : "set WEFTER_IOS_SIGNING_IDENTITY (a certificate common name already in the build machine's keychain) before running a release build",
    });
  }

  return results;
}
