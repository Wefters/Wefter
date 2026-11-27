import { describe, expect, it } from "vitest";
import { legacyConfigNotes, WefterConfigSchema } from "../src/config/wefter-config-schema.js";

describe("WefterConfigSchema — iOS fields", () => {
  it("accepts a config with no iOS-specific fields at all — fully backward compatible", () => {
    const result = WefterConfigSchema.safeParse({
      environments: { production: { appId: "com.example.app", appName: "Example" } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.environments.production.iosBundleId).toBeUndefined();
      expect(result.data.iosSigning).toBeUndefined();
    }
  });

  it("accepts an explicit iosBundleId override per environment", () => {
    const result = WefterConfigSchema.safeParse({
      environments: {
        production: { appId: "com.example.app", appName: "Example", iosBundleId: "com.example.ios" },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.environments.production.iosBundleId).toBe("com.example.ios");
    }
  });

  it("accepts signing.ios with just a teamId (automatic signing — no provisioning profile)", () => {
    const result = WefterConfigSchema.safeParse({
      environments: { production: { appId: "com.example.app", appName: "Example" } },
      signing: { ios: { teamId: "ABCDE12345" } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signing?.ios).toEqual({ teamId: "ABCDE12345" });
    }
  });

  it("moves the older iosSigning block to signing.ios", () => {
    const result = WefterConfigSchema.safeParse({
      environments: { production: { appId: "com.example.app", appName: "Example" } },
      iosSigning: { teamId: "ABCDE12345", provisioningProfile: "MyApp Distribution" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signing?.ios?.provisioningProfile).toBe("MyApp Distribution");
      expect("iosSigning" in result.data).toBe(false);
    }
  });

  it("rejects iosSigning missing the required teamId", () => {
    const result = WefterConfigSchema.safeParse({
      environments: { production: { appId: "com.example.app", appName: "Example" } },
      iosSigning: { provisioningProfile: "MyApp Distribution" },
    });

    expect(result.success).toBe(false);
  });

  it("moves the older flat Android signing and iosSigning into signing.android and signing.ios", () => {
    const raw = {
      environments: { production: { appId: "com.example.app", appName: "Example" } },
      signing: { keystorePath: "release.jks", keyAlias: "release" },
      iosSigning: { teamId: "ABCDE12345" },
    };
    const result = WefterConfigSchema.safeParse(raw);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signing).toEqual({
        android: { keystorePath: "release.jks", keyAlias: "release" },
        ios: { teamId: "ABCDE12345" },
      });
    }
    expect(legacyConfigNotes(raw)).toHaveLength(2);
  });

  describe("orientation field", () => {
    const environments = { production: { appId: "com.example.app", appName: "Example" } };

    it("is undefined when omitted (sync then locks phones to portrait)", () => {
      const result = WefterConfigSchema.parse({ environments });
      expect(result.orientation).toBeUndefined();
    });

    it.each(["portrait", "landscape", "any"] as const)("accepts %s", (orientation) => {
      expect(WefterConfigSchema.parse({ environments, orientation }).orientation).toBe(orientation);
    });

    it("rejects other values", () => {
      expect(WefterConfigSchema.safeParse({ environments, orientation: "upside-down" }).success).toBe(false);
    });

    it('moves "landscape": true to "orientation": "landscape", with a note', () => {
      const raw = { environments, landscape: true };
      const result = WefterConfigSchema.parse(raw);
      expect(result.orientation).toBe("landscape");
      expect(result).not.toHaveProperty("landscape");
      expect(legacyConfigNotes(raw)).toEqual(['"landscape": true is now "orientation": "landscape"']);
    });

    it('drops "landscape": false, leaving the portrait default, with a note about "any"', () => {
      const raw = { environments, landscape: false };
      const result = WefterConfigSchema.parse(raw);
      expect(result.orientation).toBeUndefined();
      expect(result).not.toHaveProperty("landscape");
      expect(legacyConfigNotes(raw)[0]).toMatch(/"orientation": "any"/);
    });

    it('keeps an explicit "orientation" over a legacy "landscape"', () => {
      expect(WefterConfigSchema.parse({ environments, landscape: true, orientation: "any" }).orientation).toBe("any");
    });
  });
});

describe("WefterConfigSchema — deepLinks", () => {
  const base = { environments: { production: { appId: "com.example.app", appName: "Example" } } };

  it("is optional, and so is each of its fields", () => {
    expect(WefterConfigSchema.parse(base).deepLinks).toBeUndefined();
    expect(WefterConfigSchema.parse({ ...base, deepLinks: {} }).deepLinks).toEqual({});
  });

  it("accepts lower-case custom schemes", () => {
    const result = WefterConfigSchema.parse({ ...base, deepLinks: { schemes: ["myshop", "my-shop.v2"] } });
    expect(result.deepLinks.schemes).toEqual(["myshop", "my-shop.v2"]);
  });

  it.each(["MyShop", "1shop", "my_shop", "my shop"])("rejects the badly formed scheme %s", (scheme) => {
    expect(WefterConfigSchema.safeParse({ ...base, deepLinks: { schemes: [scheme] } }).success).toBe(false);
  });

  it.each(["https", "app", "wefter", "intent"])("rejects the reserved scheme %s", (scheme) => {
    expect(WefterConfigSchema.safeParse({ ...base, deepLinks: { schemes: [scheme] } }).success).toBe(false);
  });

  it("rejects a scheme ending in .auth, which sign-in redirects use", () => {
    const result = WefterConfigSchema.safeParse({ ...base, deepLinks: { schemes: ["com.example.app.auth"] } });
    expect(result.success).toBe(false);
  });

  it("rejects a scheme listed twice", () => {
    expect(WefterConfigSchema.safeParse({ ...base, deepLinks: { schemes: ["myshop", "myshop"] } }).success).toBe(false);
  });
});

describe("WefterConfigSchema — version, build and environments", () => {
  const environments = { production: { appId: "com.example.app", appName: "Example" } };

  it("accepts a version and a build number", () => {
    const result = WefterConfigSchema.safeParse({ environments, version: "1.4.0", buildNumber: 42 });
    expect(result.success).toBe(true);
  });

  it("rejects a version that is not three numbers, and a build number out of range", () => {
    expect(WefterConfigSchema.safeParse({ environments, version: "1.4" }).success).toBe(false);
    expect(WefterConfigSchema.safeParse({ environments, version: "1.4.0+42" }).success).toBe(false);
    expect(WefterConfigSchema.safeParse({ environments, buildNumber: 0 }).success).toBe(false);
    expect(WefterConfigSchema.safeParse({ environments, buildNumber: 2_100_000_001 }).success).toBe(false);
    expect(WefterConfigSchema.safeParse({ environments, buildNumber: 1.5 }).success).toBe(false);
  });

  it("fills in build defaults: output build, export method app-store-connect", () => {
    const result = WefterConfigSchema.safeParse({ environments });
    expect(result.success && result.data.build).toEqual({
      output: "build",
      android: {},
      ios: { exportMethod: "app-store-connect" },
    });
  });

  it("maps the older export method names to the current ones", () => {
    const result = WefterConfigSchema.safeParse({ environments, build: { ios: { exportMethod: "ad-hoc" } } });
    expect(result.success && result.data.build.ios.exportMethod).toBe("release-testing");
    expect(WefterConfigSchema.safeParse({ environments, build: { ios: { exportMethod: "store" } } }).success).toBe(
      false,
    );
  });

  it("accepts an Android format and rejects unknown ones", () => {
    expect(WefterConfigSchema.safeParse({ environments, build: { android: { format: "aab" } } }).success).toBe(true);
    expect(WefterConfigSchema.safeParse({ environments, build: { android: { format: "zip" } } }).success).toBe(false);
  });

  it("accepts environment names Gradle and Xcode can use, and rejects the rest", () => {
    const env = { appId: "com.example.app", appName: "Example" };
    expect(WefterConfigSchema.safeParse({ environments: { staging: env, qaEu: env } }).success).toBe(true);
    for (const name of ["Staging", "pre-prod", "release", "test", "2fast"]) {
      expect(WefterConfigSchema.safeParse({ environments: { [name]: env } }).success).toBe(false);
    }
  });

  it("accepts signing.android with passwords read from the environment", () => {
    const result = WefterConfigSchema.safeParse({
      environments,
      signing: {
        android: {
          keystorePath: "keys/upload.jks",
          keyAlias: "upload",
          storePassword: "${WEFTER_KEYSTORE_PASSWORD}",
          keyPassword: "${WEFTER_KEY_PASSWORD}",
        },
      },
    });
    expect(result.success && result.data.signing?.android?.storePassword).toBe("${WEFTER_KEYSTORE_PASSWORD}");
  });
});
