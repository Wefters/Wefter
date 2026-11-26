/**
 * Points the Android shell at the LAN dev server for `wefter run --watch`, and lets debug builds load plain
 * HTTP from that address.
 */

import { readFileSync, writeFileSync } from "node:fs";

/**
 * The debug `DEV_SERVER_URL` build config field in `build.gradle.kts`, found by its trailing marker comment.
 */
const DEV_SERVER_FIELD_PATTERN =
  /buildConfigField\("String", "DEV_SERVER_URL", "\\".*?\\""\)\s*\/\/ overridden per-run by the CLI/;

/** Sets the debug dev server URL in `build.gradle.kts`. */
export function injectDevServerUrl(buildGradlePath: string, devServerUrl: string): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  const updated = current.replace(
    DEV_SERVER_FIELD_PATTERN,
    `buildConfigField("String", "DEV_SERVER_URL", "\\"${devServerUrl}\\"") // overridden per-run by the CLI`,
  );
  writeFileSync(buildGradlePath, updated);
}

/** Clears the dev server URL so the app loads its bundled web assets. */
export function resetDevServerUrl(buildGradlePath: string): void {
  injectDevServerUrl(buildGradlePath, "");
}

/** Adds `lanIp` to the cleartext-allowed domains of the debug network security config, once. */
export function injectNetworkSecurityException(networkSecurityConfigPath: string, lanIp: string): void {
  const current = readFileSync(networkSecurityConfigPath, "utf-8");
  if (current.includes(`>${lanIp}<`)) return;
  const updated = current.replace(
    "</domain-config>",
    `        <domain includeSubdomains="true">${lanIp}</domain>\n    </domain-config>`,
  );
  writeFileSync(networkSecurityConfigPath, updated);
}
