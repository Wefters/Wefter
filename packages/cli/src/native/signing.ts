import { resolve } from "node:path";
import type { WefterConfig } from "../config/wefter-config-schema.js";

/**
 * The keystore password from `WEFTER_KEYSTORE_PASSWORD`. It is never stored in the config.
 *
 * @throws {Error} When the variable is not set.
 */
export function getSigningPassword(): string {
  const pw = process.env.WEFTER_KEYSTORE_PASSWORD;
  if (!pw) {
    throw new Error("WEFTER_KEYSTORE_PASSWORD not set. Add it to .env (gitignored) before running a release build.");
  }
  return pw;
}

/** Environment variables Gradle reads to sign release builds. Empty when no signing is configured. */
export function buildSigningEnv(projectDir: string, config: WefterConfig): NodeJS.ProcessEnv {
  if (!config.signing) return {};
  return {
    WEFTER_KEYSTORE_PATH: resolve(projectDir, config.signing.keystorePath),
    WEFTER_KEY_ALIAS: config.signing.keyAlias,
    WEFTER_KEYSTORE_PASSWORD: getSigningPassword(),
  };
}
