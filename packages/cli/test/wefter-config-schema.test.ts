import { describe, expect, it } from "vitest";
import { WefterConfigSchema } from "../src/config/wefter-config-schema.js";

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

  it("accepts iosSigning with just a teamId (automatic signing — no provisioning profile)", () => {
    const result = WefterConfigSchema.safeParse({
      environments: { production: { appId: "com.example.app", appName: "Example" } },
      iosSigning: { teamId: "ABCDE12345" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.iosSigning).toEqual({ teamId: "ABCDE12345" });
    }
  });

  it("accepts iosSigning with a provisioning profile for manual signing", () => {
    const result = WefterConfigSchema.safeParse({
      environments: { production: { appId: "com.example.app", appName: "Example" } },
      iosSigning: { teamId: "ABCDE12345", provisioningProfile: "MyApp Distribution" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.iosSigning?.provisioningProfile).toBe("MyApp Distribution");
    }
  });

  it("rejects iosSigning missing the required teamId", () => {
    const result = WefterConfigSchema.safeParse({
      environments: { production: { appId: "com.example.app", appName: "Example" } },
      iosSigning: { provisioningProfile: "MyApp Distribution" },
    });

    expect(result.success).toBe(false);
  });

  it("leaves the existing Android `signing` field untouched by the new iosSigning field", () => {
    const result = WefterConfigSchema.safeParse({
      environments: { production: { appId: "com.example.app", appName: "Example" } },
      signing: { keystorePath: "release.jks", keyAlias: "release" },
      iosSigning: { teamId: "ABCDE12345" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signing).toEqual({ keystorePath: "release.jks", keyAlias: "release" });
      expect(result.data.iosSigning).toEqual({ teamId: "ABCDE12345" });
    }
  });

  describe("landscape field", () => {
    it("is undefined when omitted", () => {
      const result = WefterConfigSchema.safeParse({
        environments: { production: { appId: "com.example.app", appName: "Example" } },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.landscape).toBeUndefined();
      }
    });

    it("accepts landscape: true", () => {
      const result = WefterConfigSchema.safeParse({
        environments: { production: { appId: "com.example.app", appName: "Example" } },
        landscape: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.landscape).toBe(true);
      }
    });

    it("accepts landscape: false", () => {
      const result = WefterConfigSchema.safeParse({
        environments: { production: { appId: "com.example.app", appName: "Example" } },
        landscape: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.landscape).toBe(false);
      }
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
