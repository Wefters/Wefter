import type { WefterConfig } from "../config/wefter-config-schema.js";
import { resolveIosSigning, type ResolvedIosSigning } from "../config/signing-config.js";

/** iOS signing values as environment variables, for hooks and scripts. */
export function buildIosSigningEnv(config: WefterConfig, projectDir = process.cwd()): NodeJS.ProcessEnv {
  const signing = resolveIosSigning(projectDir, config);
  if (!signing) return {};

  const env: NodeJS.ProcessEnv = { WEFTER_IOS_TEAM_ID: signing.teamId };
  if (signing.signingIdentity) env.WEFTER_IOS_SIGNING_IDENTITY = signing.signingIdentity;
  if (signing.provisioningProfile) env.WEFTER_IOS_PROVISIONING_PROFILE = signing.provisioningProfile;
  return env;
}

/**
 * xcodebuild settings for release signing: the team, a manual provisioning profile when one is configured,
 * and the signing identity when one is given.
 */
export function iosSigningBuildSettings(config: WefterConfig, projectDir = process.cwd()): string[] {
  const signing = resolveIosSigning(projectDir, config);
  return signing ? signingSettingsFor(signing) : [];
}

/** {@link iosSigningBuildSettings} for already resolved signing. */
export function signingSettingsFor(signing: ResolvedIosSigning): string[] {
  const settings = [`DEVELOPMENT_TEAM=${signing.teamId}`];
  if (signing.provisioningProfile) {
    settings.push("CODE_SIGN_STYLE=Manual", `PROVISIONING_PROFILE_SPECIFIER=${signing.provisioningProfile}`);
  }
  if (signing.signingIdentity) settings.push(`CODE_SIGN_IDENTITY=${signing.signingIdentity}`);
  return settings;
}

/**
 * xcodebuild arguments that let automatic signing create or download certificates and profiles with an App
 * Store Connect API key. Empty without a key.
 */
export function appStoreConnectAuthArgs(signing: ResolvedIosSigning | null): string[] {
  const key = signing?.appStoreConnect;
  if (!key) return [];
  return [
    "-allowProvisioningUpdates",
    "-authenticationKeyPath",
    key.keyPath,
    "-authenticationKeyID",
    key.keyId,
    "-authenticationKeyIssuerID",
    key.issuerId,
  ];
}
