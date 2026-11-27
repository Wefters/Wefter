import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSigningEnv, getSigningPassword } from "../src/native/signing.js";
import type { WefterConfig } from "../src/config/wefter-config-schema.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  for (const name of ["WEFTER_KEYSTORE_PASSWORD", "WEFTER_KEY_PASSWORD", "WEFTER_KEYSTORE_PATH", "WEFTER_KEY_ALIAS"]) {
    delete process.env[name];
  }
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
    const config = { signing: { android: { keystorePath: "./keystore.jks", keyAlias: "release" } } } as WefterConfig;
    expect(() => buildSigningEnv("/fake/project", config)).toThrow(/keystore password is not set/);
  });

  it("resolves the keystore path relative to the project dir and passes the alias/password through", () => {
    process.env.WEFTER_KEYSTORE_PASSWORD = "hunter2";
    const config = { signing: { android: { keystorePath: "./keystore.jks", keyAlias: "release" } } } as WefterConfig;

    const env = buildSigningEnv("/fake/project", config);

    expect(env.WEFTER_KEYSTORE_PATH).toBe("/fake/project/keystore.jks");
    expect(env.WEFTER_KEY_ALIAS).toBe("release");
    expect(env.WEFTER_KEYSTORE_PASSWORD).toBe("hunter2");
    expect(env.WEFTER_KEY_PASSWORD).toBe("hunter2");
  });

  it("reads passwords written as ${VAR} in the config, and a separate key password", () => {
    process.env.STORE_PW = "store-secret";
    process.env.KEY_PW = "key-secret";
    const config = {
      signing: {
        android: {
          keystorePath: "keys/upload.jks",
          keyAlias: "upload",
          storePassword: "${STORE_PW}",
          keyPassword: "${KEY_PW}",
        },
      },
    } as WefterConfig;

    const env = buildSigningEnv("/fake/project", config);

    expect(env.WEFTER_KEYSTORE_PATH).toBe("/fake/project/keys/upload.jks");
    expect(env.WEFTER_KEYSTORE_PASSWORD).toBe("store-secret");
    expect(env.WEFTER_KEY_PASSWORD).toBe("key-secret");
  });

  it("names the variable a ${VAR} password reads when it is not set", () => {
    const config = {
      signing: { android: { keystorePath: "k.jks", keyAlias: "a", storePassword: "${MISSING_PW}" } },
    } as WefterConfig;
    expect(() => buildSigningEnv("/fake/project", config)).toThrow(/storePassword reads \$\{MISSING_PW\}/);
  });

  it("lets WEFTER_* variables override the config", () => {
    process.env.WEFTER_KEYSTORE_PASSWORD = "from-env";
    process.env.WEFTER_KEY_ALIAS = "ci-alias";
    const config = {
      signing: { android: { keystorePath: "k.jks", keyAlias: "a", storePassword: "literal" } },
    } as WefterConfig;

    const env = buildSigningEnv("/fake/project", config);

    expect(env.WEFTER_KEYSTORE_PASSWORD).toBe("from-env");
    expect(env.WEFTER_KEY_ALIAS).toBe("ci-alias");
  });
});
