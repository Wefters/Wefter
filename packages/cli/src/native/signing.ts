import type { WefterConfig } from "../config/wefter-config-schema.js";
import { ANDROID_SIGNING_ENV, resolveAndroidSigning } from "../config/signing-config.js";

/**
 * The keystore password from `WEFTER_KEYSTORE_PASSWORD`.
 *
 * @throws {Error} When the variable is not set.
 * @deprecated Use {@link resolveAndroidSigning}, which also reads `signing.android.storePassword`.
 */
export function getSigningPassword(): string {
  const pw = process.env.WEFTER_KEYSTORE_PASSWORD;
  if (!pw) {
    throw new Error("WEFTER_KEYSTORE_PASSWORD not set. Add it to .env (gitignored) before running a release build.");
  }
  return pw;
}

/**
 * Environment variables Gradle reads to sign release builds: the keystore, alias and both passwords. Empty
 * when no signing is configured.
 *
 * @throws {Error} When signing is configured but a value is missing, such as the keystore password.
 */
export function buildSigningEnv(projectDir: string, config: WefterConfig): NodeJS.ProcessEnv {
  const signing = resolveAndroidSigning(projectDir, config);
  if (!signing) return {};
  if (signing.problems.length > 0) {
    throw new Error(`Android signing is incomplete:\n${signing.problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  return {
    [ANDROID_SIGNING_ENV.keystorePath]: signing.keystorePath,
    [ANDROID_SIGNING_ENV.keyAlias]: signing.keyAlias,
    [ANDROID_SIGNING_ENV.storePassword]: signing.storePassword,
    [ANDROID_SIGNING_ENV.keyPassword]: signing.keyPassword,
  };
}
