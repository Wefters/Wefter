/**
 * SHA-256 fingerprints of Android signing certificates, which `assetlinks.json` lists so Android can verify
 * that an app may open a domain's links.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The keystore Android Studio and Gradle sign debug builds with, and its fixed alias and password. */
export const DEBUG_KEYSTORE = {
  path: join(homedir(), ".android", "debug.keystore"),
  alias: "androiddebugkey",
  password: "android",
};

/**
 * A fingerprint in the form `assetlinks.json` expects: 32 upper-case hex pairs joined by colons. Accepts
 * any case, with or without colons.
 *
 * @returns The normalised fingerprint, or `null` when `value` is not a SHA-256 fingerprint.
 */
export function normalizeFingerprint(value: string): string | null {
  const hex = value.replace(/[:\s]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g)!.join(":");
}

/** The SHA-256 fingerprint in the output of `keytool -list -v`, or `null` when there is none. */
export function parseSha256Fingerprint(keytoolOutput: string): string | null {
  const match = /SHA-?256:\s*([0-9A-Fa-f:]{95})/.exec(keytoolOutput);
  return match ? normalizeFingerprint(match[1]) : null;
}

/** `keytool` from `JAVA_HOME` when it is set, else from the `PATH`. */
function keytoolCommand(): string {
  const javaHome = process.env.JAVA_HOME;
  const fromJavaHome = javaHome
    ? join(javaHome, "bin", process.platform === "win32" ? "keytool.exe" : "keytool")
    : null;
  return fromJavaHome && existsSync(fromJavaHome) ? fromJavaHome : "keytool";
}

/** Environment variable the keystore password is handed to keytool in, so it never shows in `ps`. */
const STOREPASS_ENV = "WEFTER_KEYTOOL_STOREPASS";

/**
 * Reads the SHA-256 fingerprint of the certificate under `alias` in a keystore.
 *
 * @throws {Error} When keytool cannot be run, the password is wrong, or the alias does not exist.
 */
export function readKeystoreFingerprint(keystorePath: string, alias: string, password: string): Promise<string> {
  const args = ["-list", "-v", "-keystore", keystorePath, "-alias", alias, "-storepass:env", STOREPASS_ENV];
  const env = { ...process.env, [STOREPASS_ENV]: password };
  return new Promise((resolve, reject) => {
    execFile(keytoolCommand(), args, { env }, (error, stdout, stderr) => {
      const fingerprint = parseSha256Fingerprint(stdout);
      if (error || !fingerprint) {
        const reason = (stderr || stdout || error?.message || "").trim().split("\n")[0];
        reject(new Error(`Could not read the certificate "${alias}" from ${keystorePath}: ${reason}`));
        return;
      }
      resolve(fingerprint);
    });
  });
}
