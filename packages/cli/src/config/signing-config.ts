/**
 * Release signing settings, resolved from `signing.android` / `signing.ios` in `wefter.config.json` and the
 * environment. Every setting can be overridden by a `WEFTER_*` variable (for CI), and config values may read
 * variables with `${VAR}`; see {@link resolveSetting}.
 */

import { isAbsolute, resolve } from "node:path";
import { referencesEnvironment, resolveSetting } from "./config-values.js";
import type { WefterConfig } from "./wefter-config-schema.js";

/** Environment variables that override each Android signing setting. */
export const ANDROID_SIGNING_ENV = {
  keystorePath: "WEFTER_KEYSTORE_PATH",
  keyAlias: "WEFTER_KEY_ALIAS",
  storePassword: "WEFTER_KEYSTORE_PASSWORD",
  keyPassword: "WEFTER_KEY_PASSWORD",
} as const;

/** Environment variables that override each iOS signing setting. */
export const IOS_SIGNING_ENV = {
  teamId: "WEFTER_IOS_TEAM_ID",
  provisioningProfile: "WEFTER_IOS_PROVISIONING_PROFILE",
  signingIdentity: "WEFTER_IOS_SIGNING_IDENTITY",
  ascKeyPath: "WEFTER_ASC_KEY_PATH",
  ascKeyId: "WEFTER_ASC_KEY_ID",
  ascIssuerId: "WEFTER_ASC_ISSUER_ID",
} as const;

/**
 * Android signing as it will be used. `storePassword` and `keyPassword` are `undefined` when not given;
 * `keyPassword` already falls back to `storePassword`. `problems` lists what is missing.
 */
export interface ResolvedAndroidSigning {
  keystorePath: string;
  keyAlias: string;
  storePassword: string | undefined;
  keyPassword: string | undefined;
  problems: string[];
}

/** A path relative to the project, made absolute. */
function projectPath(projectDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectDir, path);
}

/** "VAR is not set" messages for the variables a setting referenced. */
function missingMessages(setting: string, missing: string[]): string[] {
  return missing.map((name) => `${setting} reads \${${name}}, which is not set`);
}

/**
 * The Android signing settings, or `null` when none are configured (no `signing.android` and no
 * `WEFTER_KEYSTORE_PATH`).
 */
export function resolveAndroidSigning(
  projectDir: string,
  config: WefterConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedAndroidSigning | null {
  const android = config.signing?.android;
  const keystorePath = resolveSetting(ANDROID_SIGNING_ENV.keystorePath, android?.keystorePath, env);
  if (!android && keystorePath.value === undefined) return null;

  const keyAlias = resolveSetting(ANDROID_SIGNING_ENV.keyAlias, android?.keyAlias, env);
  const storePassword = resolveSetting(ANDROID_SIGNING_ENV.storePassword, android?.storePassword, env);
  const keyPassword = resolveSetting(ANDROID_SIGNING_ENV.keyPassword, android?.keyPassword, env);

  const problems = [
    ...missingMessages("signing.android.keystorePath", keystorePath.missing),
    ...missingMessages("signing.android.keyAlias", keyAlias.missing),
    ...missingMessages("signing.android.storePassword", storePassword.missing),
    ...missingMessages("signing.android.keyPassword", keyPassword.missing),
  ];
  if (keystorePath.value === undefined && keystorePath.missing.length === 0) {
    problems.push("signing.android.keystorePath is not set");
  }
  if (keyAlias.value === undefined && keyAlias.missing.length === 0) {
    problems.push("signing.android.keyAlias is not set");
  }
  if (storePassword.value === undefined && storePassword.missing.length === 0) {
    problems.push(
      `the keystore password is not set: add "storePassword": "\${${ANDROID_SIGNING_ENV.storePassword}}" to signing.android ` +
        `and set ${ANDROID_SIGNING_ENV.storePassword} in .env (gitignored) or your CI secrets`,
    );
  }

  return {
    keystorePath: keystorePath.value ? projectPath(projectDir, keystorePath.value) : "",
    keyAlias: keyAlias.value ?? "",
    storePassword: storePassword.value,
    keyPassword: keyPassword.value ?? storePassword.value,
    problems,
  };
}

/** An App Store Connect API key, used by xcodebuild to sign automatically on machines without your account. */
export interface AppStoreConnectKey {
  keyPath: string;
  keyId: string;
  issuerId: string;
}

/** iOS signing as it will be used. `problems` lists what is missing. */
export interface ResolvedIosSigning {
  teamId: string;
  provisioningProfile: string | undefined;
  signingIdentity: string | undefined;
  appStoreConnect: AppStoreConnectKey | undefined;
  problems: string[];
}

/**
 * The iOS signing settings, or `null` when none are configured (no `signing.ios` and no
 * `WEFTER_IOS_TEAM_ID`).
 */
export function resolveIosSigning(
  projectDir: string,
  config: WefterConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedIosSigning | null {
  const ios = config.signing?.ios;
  const teamId = resolveSetting(IOS_SIGNING_ENV.teamId, ios?.teamId, env);
  if (!ios && teamId.value === undefined) return null;

  const profile = resolveSetting(IOS_SIGNING_ENV.provisioningProfile, ios?.provisioningProfile, env);
  const identity = resolveSetting(IOS_SIGNING_ENV.signingIdentity, ios?.signingIdentity, env);
  const ascKeyPath = resolveSetting(IOS_SIGNING_ENV.ascKeyPath, ios?.appStoreConnect?.keyPath, env);
  const ascKeyId = resolveSetting(IOS_SIGNING_ENV.ascKeyId, ios?.appStoreConnect?.keyId, env);
  const ascIssuerId = resolveSetting(IOS_SIGNING_ENV.ascIssuerId, ios?.appStoreConnect?.issuerId, env);

  const problems = [
    ...missingMessages("signing.ios.teamId", teamId.missing),
    ...missingMessages("signing.ios.provisioningProfile", profile.missing),
    ...missingMessages("signing.ios.signingIdentity", identity.missing),
    ...missingMessages("signing.ios.appStoreConnect.keyPath", ascKeyPath.missing),
    ...missingMessages("signing.ios.appStoreConnect.keyId", ascKeyId.missing),
    ...missingMessages("signing.ios.appStoreConnect.issuerId", ascIssuerId.missing),
  ];
  if (teamId.value === undefined && teamId.missing.length === 0) problems.push("signing.ios.teamId is not set");

  const ascParts = [ascKeyPath.value, ascKeyId.value, ascIssuerId.value];
  const ascGiven = ascParts.filter((part) => part !== undefined).length;
  if (ascGiven > 0 && ascGiven < 3) {
    problems.push("signing.ios.appStoreConnect needs keyPath, keyId and issuerId together");
  }

  return {
    teamId: teamId.value ?? "",
    provisioningProfile: profile.value,
    signingIdentity: identity.value,
    appStoreConnect:
      ascGiven === 3
        ? { keyPath: projectPath(projectDir, ascKeyPath.value!), keyId: ascKeyId.value!, issuerId: ascIssuerId.value! }
        : undefined,
    problems,
  };
}

/**
 * Passwords written out in full in the config, rather than read from the environment with `${VAR}`. Such a
 * config must not be committed.
 */
export function literalSecretSettings(config: WefterConfig): string[] {
  const android = config.signing?.android;
  const literal: string[] = [];
  if (android?.storePassword && !referencesEnvironment(android.storePassword)) {
    literal.push("signing.android.storePassword");
  }
  if (android?.keyPassword && !referencesEnvironment(android.keyPassword)) {
    literal.push("signing.android.keyPassword");
  }
  return literal;
}
