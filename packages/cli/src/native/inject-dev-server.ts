import { readFileSync, writeFileSync } from "node:fs";

const DEV_SERVER_FIELD_PATTERN =
  /buildConfigField\("String", "DEV_SERVER_URL", "\\".*?\\""\)\s*\/\/ overridden per-run by the CLI/;

export function injectDevServerUrl(buildGradlePath: string, devServerUrl: string): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  const updated = current.replace(
    DEV_SERVER_FIELD_PATTERN,
    `buildConfigField("String", "DEV_SERVER_URL", "\\"${devServerUrl}\\"") // overridden per-run by the CLI`,
  );
  writeFileSync(buildGradlePath, updated);
}

export function resetDevServerUrl(buildGradlePath: string): void {
  injectDevServerUrl(buildGradlePath, "");
}

export function injectNetworkSecurityException(networkSecurityConfigPath: string, lanIp: string): void {
  const current = readFileSync(networkSecurityConfigPath, "utf-8");
  if (current.includes(`>${lanIp}<`)) return;
  const updated = current.replace(
    "</domain-config>",
    `        <domain includeSubdomains="true">${lanIp}</domain>\n    </domain-config>`,
  );
  writeFileSync(networkSecurityConfigPath, updated);
}
