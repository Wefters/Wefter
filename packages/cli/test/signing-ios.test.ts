import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIosSigningEnv, iosSigningBuildSettings } from "../src/native/signing-ios.js";
import type { WefterConfig } from "../src/config/wefter-config-schema.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.WEFTER_IOS_SIGNING_IDENTITY;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("buildIosSigningEnv", () => {
  it("returns an empty object when iosSigning isn't configured at all", () => {
    const config = { iosSigning: undefined } as unknown as WefterConfig;
    expect(buildIosSigningEnv(config)).toEqual({});
  });

  it("passes the team ID through unconditionally when configured", () => {
    const config = { iosSigning: { teamId: "ABCDE12345" } } as WefterConfig;
    expect(buildIosSigningEnv(config).WEFTER_IOS_TEAM_ID).toBe("ABCDE12345");
  });

  it("includes the provisioning profile only when one is declared", () => {
    const withProfile = { iosSigning: { teamId: "ABCDE12345", provisioningProfile: "MyApp Distribution" } } as WefterConfig;
    const withoutProfile = { iosSigning: { teamId: "ABCDE12345" } } as WefterConfig;

    expect(buildIosSigningEnv(withProfile).WEFTER_IOS_PROVISIONING_PROFILE).toBe("MyApp Distribution");
    expect(buildIosSigningEnv(withoutProfile).WEFTER_IOS_PROVISIONING_PROFILE).toBeUndefined();
  });

  it("includes the signing identity from the environment when set, omits it otherwise", () => {
    const config = { iosSigning: { teamId: "ABCDE12345" } } as WefterConfig;

    expect(buildIosSigningEnv(config).WEFTER_IOS_SIGNING_IDENTITY).toBeUndefined();

    process.env.WEFTER_IOS_SIGNING_IDENTITY = "Apple Distribution: Example Inc (ABCDE12345)";
    expect(buildIosSigningEnv(config).WEFTER_IOS_SIGNING_IDENTITY).toBe("Apple Distribution: Example Inc (ABCDE12345)");
  });
});

describe("iosSigningBuildSettings", () => {
  it("returns no build settings when iosSigning isn't configured", () => {
    const config = { iosSigning: undefined } as unknown as WefterConfig;
    expect(iosSigningBuildSettings(config)).toEqual([]);
  });

  it("sets DEVELOPMENT_TEAM but leaves automatic signing alone when no provisioning profile is given", () => {
    const config = { iosSigning: { teamId: "ABCDE12345" } } as WefterConfig;

    const settings = iosSigningBuildSettings(config);

    expect(settings).toContain("DEVELOPMENT_TEAM=ABCDE12345");
    expect(settings.some((s) => s.startsWith("CODE_SIGN_STYLE="))).toBe(false);
  });

  it("switches to manual signing with a specific profile when one is declared", () => {
    const config = { iosSigning: { teamId: "ABCDE12345", provisioningProfile: "MyApp Distribution" } } as WefterConfig;

    const settings = iosSigningBuildSettings(config);

    expect(settings).toContain("CODE_SIGN_STYLE=Manual");
    expect(settings).toContain("PROVISIONING_PROFILE_SPECIFIER=MyApp Distribution");
  });

  it("includes CODE_SIGN_IDENTITY only when WEFTER_IOS_SIGNING_IDENTITY is set", () => {
    const config = { iosSigning: { teamId: "ABCDE12345" } } as WefterConfig;
    process.env.WEFTER_IOS_SIGNING_IDENTITY = "Apple Distribution: Example Inc (ABCDE12345)";

    const settings = iosSigningBuildSettings(config);

    expect(settings).toContain("CODE_SIGN_IDENTITY=Apple Distribution: Example Inc (ABCDE12345)");
  });
});
