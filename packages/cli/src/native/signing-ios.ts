import type { WefterConfig } from "../config/wefter-config-schema.js";

export function buildIosSigningEnv(config: WefterConfig): NodeJS.ProcessEnv {
  if (!config.iosSigning) return {};

  const env: NodeJS.ProcessEnv = {
    WEFTER_IOS_TEAM_ID: config.iosSigning.teamId,
  };

  const identity = process.env.WEFTER_IOS_SIGNING_IDENTITY;
  if (identity) env.WEFTER_IOS_SIGNING_IDENTITY = identity;

  if (config.iosSigning.provisioningProfile) {
    env.WEFTER_IOS_PROVISIONING_PROFILE = config.iosSigning.provisioningProfile;
  }

  return env;
}

export function iosSigningBuildSettings(config: WefterConfig): string[] {
  if (!config.iosSigning) return [];

  const settings = [`DEVELOPMENT_TEAM=${config.iosSigning.teamId}`];

  if (config.iosSigning.provisioningProfile) {
    settings.push("CODE_SIGN_STYLE=Manual", `PROVISIONING_PROFILE_SPECIFIER=${config.iosSigning.provisioningProfile}`);
  }

  const identity = process.env.WEFTER_IOS_SIGNING_IDENTITY;
  if (identity) settings.push(`CODE_SIGN_IDENTITY=${identity}`);

  return settings;
}
