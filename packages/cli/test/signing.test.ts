import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSigningEnv, getSigningPassword } from "../src/native/signing.js";
import type { WefterConfig } from "../src/config/wefter-config-schema.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.WEFTER_KEYSTORE_PASSWORD;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("getSigningPassword", () => {
  it("throws a clear error when WEFTER_KEYSTORE_PASSWORD is not set", () => {
    expect(() => getSigningPassword()).toThrow(/WEFTER_KEYSTORE_PASSWORD not set/);
  });

  it("returns the password when set", () => {
    process.env.WEFTER_KEYSTORE_PASSWORD = "hunter2";
    expect(getSigningPassword()).toBe("hunter2");
  });
});

describe("buildSigningEnv", () => {
  it("returns an empty object when signing isn't configured at all", () => {
    const config = { signing: undefined } as unknown as WefterConfig;
    expect(buildSigningEnv("/fake/project", config)).toEqual({});
  });

  it("throws when signing is configured but the password is missing", () => {
    const config = { signing: { keystorePath: "./keystore.jks", keyAlias: "release" } } as WefterConfig;
    expect(() => buildSigningEnv("/fake/project", config)).toThrow(/WEFTER_KEYSTORE_PASSWORD not set/);
  });

  it("resolves the keystore path relative to the project dir and passes the alias/password through", () => {
    process.env.WEFTER_KEYSTORE_PASSWORD = "hunter2";
    const config = { signing: { keystorePath: "./keystore.jks", keyAlias: "release" } } as WefterConfig;

    const env = buildSigningEnv("/fake/project", config);

    expect(env.WEFTER_KEYSTORE_PATH).toBe("/fake/project/keystore.jks");
    expect(env.WEFTER_KEY_ALIAS).toBe("release");
    expect(env.WEFTER_KEYSTORE_PASSWORD).toBe("hunter2");
  });
});
