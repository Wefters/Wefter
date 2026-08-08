import { readFileSync, writeFileSync } from "node:fs";

const DEV_SERVER_FIELD_PATTERN = /static let devServerURL = "(?:[^"\\]|\\.)*" \/\/ WEFTER overridden per-run by the CLI/;

export function injectDevServerUrlIos(buildConfigPath: string, devServerUrl: string): void {
  const current = readFileSync(buildConfigPath, "utf-8");
  const updated = current.replace(
    DEV_SERVER_FIELD_PATTERN,
    `static let devServerURL = "${devServerUrl}" // WEFTER overridden per-run by the CLI`,
  );
  writeFileSync(buildConfigPath, updated);
}

export function resetDevServerUrlIos(buildConfigPath: string): void {
  injectDevServerUrlIos(buildConfigPath, "");
}

const ATS_START = "<!-- WEFTER-ATS-EXCEPTIONS-START -->";
const ATS_END = "<!-- WEFTER-ATS-EXCEPTIONS-END -->";

function buildExceptionDomainsBlock(lanIps: string[]): string {
  if (lanIps.length === 0) {
    return "\t\t<key>NSExceptionDomains</key>\n\t\t<dict/>";
  }
  const entries = lanIps
    .map(
      (ip) =>
        `\t\t\t<key>${ip}</key>\n\t\t\t<dict>\n\t\t\t\t<key>NSExceptionAllowsInsecureHTTPLoads</key>\n\t\t\t\t<true/>\n\t\t\t\t<key>NSIncludesSubdomains</key>\n\t\t\t\t<true/>\n\t\t\t</dict>`,
    )
    .join("\n");
  return `\t\t<key>NSExceptionDomains</key>\n\t\t<dict>\n${entries}\n\t\t</dict>`;
}

function currentLanIps(infoPlistPath: string): string[] {
  const current = readFileSync(infoPlistPath, "utf-8");
  const blockMatch = current.match(new RegExp(`${ATS_START}([\\s\\S]*?)${ATS_END}`));
  if (!blockMatch) return [];
  return [...blockMatch[1].matchAll(/<key>([\d.]+)<\/key>/g)].map((m) => m[1]);
}

function writeExceptionDomainsBlock(infoPlistPath: string, lanIps: string[]): void {
  const block = `${ATS_START}\n${buildExceptionDomainsBlock(lanIps)}\n\t\t${ATS_END}`;
  const current = readFileSync(infoPlistPath, "utf-8");
  const updated = current.replace(new RegExp(`${ATS_START}[\\s\\S]*?${ATS_END}`), block);
  writeFileSync(infoPlistPath, updated);
}

export function injectNetworkSecurityExceptionIos(infoPlistPath: string, lanIp: string): void {
  const existing = currentLanIps(infoPlistPath);
  if (existing.includes(lanIp)) return;
  writeExceptionDomainsBlock(infoPlistPath, [...existing, lanIp]);
}

export function resetNetworkSecurityExceptionsIos(infoPlistPath: string): void {
  writeExceptionDomainsBlock(infoPlistPath, []);
}
