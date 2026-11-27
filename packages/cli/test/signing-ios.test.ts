import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIosSigningEnv, iosSigningBuildSettings } from "../src/native/signing-ios.js";
import type { WefterConfig } from "../src/config/wefter-config-schema.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("WEFTER_IOS_") || name.startsWith("WEFTER_ASC_")) delete process.env[name];
  }
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("buildIosSigningEnv", () => {
  it("returns an empty object when iosSigning isn't configured at all", () => {
    const config = { signing: undefined } as unknown as WefterConfig;
    expect(buildIosSigningEnv(config)).toEqual({});
  });

  it("passes the team ID through unconditionally when configured", () => {
    const config = { signing: { ios: { teamId: "ABCDE12345" } } } as WefterConfig;
    expect(buildIosSigningEnv(config).WEFTER_IOS_TEAM_ID).toBe("ABCDE12345");
  });

  it("includes the provisioning profile only when one is declared", () => {
    const withProfile = {
      signing: { ios: { teamId: "ABCDE12345", provisioningProfile: "MyApp Distribution" } },
    } as WefterConfig;
    const withoutProfile = { signing: { ios: { teamId: "ABCDE12345" } } } as WefterConfig;

    expect(buildIosSigningEnv(withProfile).WEFTER_IOS_PROVISIONING_PROFILE).toBe("MyApp Distribution");
    expect(buildIosSigningEnv(withoutProfile).WEFTER_IOS_PROVISIONING_PROFILE).toBeUndefined();
  });

  it("includes the signing identity from the environment when set, omits it otherwise", () => {
    const config = { signing: { ios: { teamId: "ABCDE12345" } } } as WefterConfig;

    expect(buildIosSigningEnv(config).WEFTER_IOS_SIGNING_IDENTITY).toBeUndefined();

    process.env.WEFTER_IOS_SIGNING_IDENTITY = "Apple Distribution: Example Inc (ABCDE12345)";
    expect(buildIosSigningEnv(config).WEFTER_IOS_SIGNING_IDENTITY).toBe("Apple Distribution: Example Inc (ABCDE12345)");
  });
});

describe("signing.ios settings in the config", () => {
  it("uses signingIdentity from the config when no variable overrides it", () => {
    const config = {
      signing: { ios: { teamId: "ABCDE12345", signingIdentity: "Apple Distribution" } },
    } as WefterConfig;
    expect(iosSigningBuildSettings(config)).toContain("CODE_SIGN_IDENTITY=Apple Distribution");
  });

  it("gives App Store Connect key arguments when the key is configured", async () => {
    const { appStoreConnectAuthArgs } = await import("../src/native/signing-ios.js");
    const { resolveIosSigning } = await import("../src/config/signing-config.js");
    process.env.ASC_ISSUER = "issuer-uuid";
    const config = {
      signing: {
        ios: {
          teamId: "T",
          appStoreConnect: { keyPath: "keys/AuthKey.p8", keyId: "KEY123", issuerId: "${ASC_ISSUER}" },
        },
      },
    } as WefterConfig;

    const args = appStoreConnectAuthArgs(resolveIosSigning("/proj", config));

    expect(args).toEqual([
      "-allowProvisioningUpdates",
      "-authenticationKeyPath",
      "/proj/keys/AuthKey.p8",
      "-authenticationKeyID",
      "KEY123",
      "-authenticationKeyIssuerID",
      "issuer-uuid",
    ]);
  });
});

describe("iosSigningBuildSettings", () => {
  it("returns no build settings when iosSigning isn't configured", () => {
    const config = { signing: undefined } as unknown as WefterConfig;
    expect(iosSigningBuildSettings(config)).toEqual([]);
  });

  it("sets DEVELOPMENT_TEAM but leaves automatic signing alone when no provisioning profile is given", () => {
    const config = { signing: { ios: { teamId: "ABCDE12345" } } } as WefterConfig;

    const settings = iosSigningBuildSettings(config);

    expect(settings).toContain("DEVELOPMENT_TEAM=ABCDE12345");
    expect(settings.some((s) => s.startsWith("CODE_SIGN_STYLE="))).toBe(false);
  });

  it("switches to manual signing with a specific profile when one is declared", () => {
    const config = {
      signing: { ios: { teamId: "ABCDE12345", provisioningProfile: "MyApp Distribution" } },
    } as WefterConfig;

    const settings = iosSigningBuildSettings(config);

    expect(settings).toContain("CODE_SIGN_STYLE=Manual");
    expect(settings).toContain("PROVISIONING_PROFILE_SPECIFIER=MyApp Distribution");
  });

  it("includes CODE_SIGN_IDENTITY only when WEFTER_IOS_SIGNING_IDENTITY is set", () => {
    const config = { signing: { ios: { teamId: "ABCDE12345" } } } as WefterConfig;
    process.env.WEFTER_IOS_SIGNING_IDENTITY = "Apple Distribution: Example Inc (ABCDE12345)";

    const settings = iosSigningBuildSettings(config);

    expect(settings).toContain("CODE_SIGN_IDENTITY=Apple Distribution: Example Inc (ABCDE12345)");
  });
});
