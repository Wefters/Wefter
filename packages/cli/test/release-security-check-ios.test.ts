import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkReleaseSecurityIos } from "../src/native/release-security-check-ios.js";
import { iosAppDir } from "../src/config/project-paths.js";
import type { WefterConfig } from "../src/config/wefter-config-schema.js";

const BUILD_CONFIG_FIXTURE = (releaseDevServerUrl = "") => `enum BuildConfig {
    #if DEBUG
    static let devServerURL = "http://192.168.1.5:5173" // WEFTER overridden per-run by the CLI
    #else
    static let devServerURL = "${releaseDevServerUrl}" // WEFTER always empty in release — never shippable
    #endif
}
`;

const INFO_PLIST_FIXTURE = (lanIp?: string) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>NSAppTransportSecurity</key>
	<dict>
		<!-- WEFTER-ATS-EXCEPTIONS-START -->
		<key>NSExceptionDomains</key>
		<dict${lanIp ? `>\n\t\t\t<key>${lanIp}</key>\n\t\t\t<dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict>\n\t\t</dict` : "/"}>
		<!-- WEFTER-ATS-EXCEPTIONS-END -->
	</dict>
</dict>
</plist>
`;

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setUpProject(opts: { releaseDevServerUrl?: string; lanException?: string } = {}): string {
  dir = mkdtempSync(join(tmpdir(), "wefter-ios-release-check-"));
  const appDir = iosAppDir(dir);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "BuildConfig.swift"), BUILD_CONFIG_FIXTURE(opts.releaseDevServerUrl ?? ""));
  writeFileSync(join(appDir, "Info.plist"), INFO_PLIST_FIXTURE(opts.lanException));
  return dir;
}

const baseConfig: WefterConfig = {
  plugins: [],
  pluginsDir: "node_modules",
  webDir: "dist",
  environments: { production: { appId: "com.example.app", appName: "Example" } },
  iosSigning: { teamId: "ABCDE12345" },
};

describe("checkReleaseSecurityIos", () => {
  it("passes when everything is in order (release DEV_SERVER_URL empty, no ATS exceptions, signing configured)", () => {
    const projectDir = setUpProject();

    const result = checkReleaseSecurityIos(projectDir, baseConfig);

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("does not flag the DEBUG branch's DEV_SERVER_URL — only the release branch matters", () => {
    const projectDir = setUpProject();

    const result = checkReleaseSecurityIos(projectDir, baseConfig);

    expect(result.issues.some((i) => i.includes("DEV_SERVER_URL"))).toBe(false);
  });

  it("flags a non-empty release-branch DEV_SERVER_URL", () => {
    const projectDir = setUpProject({ releaseDevServerUrl: "http://leaked:5173" });

    const result = checkReleaseSecurityIos(projectDir, baseConfig);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("release branch's DEV_SERVER_URL"))).toBe(true);
  });

  it("flags a leftover ATS exception domain — iOS has no debug-only source set to make this impossible for free", () => {
    const projectDir = setUpProject({ lanException: "192.168.1.42" });

    const result = checkReleaseSecurityIos(projectDir, baseConfig);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("ATS exception"))).toBe(true);
  });

  it("flags a missing iOS native project", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-release-check-"));

    const result = checkReleaseSecurityIos(dir, baseConfig);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("iOS native project not found"))).toBe(true);
  });

  it("flags a missing iosSigning config", () => {
    const projectDir = setUpProject();

    const result = checkReleaseSecurityIos(projectDir, { ...baseConfig, iosSigning: undefined });

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("iosSigning"))).toBe(true);
  });
});
