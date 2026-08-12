import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  injectDevServerUrlIos,
  injectNetworkSecurityExceptionIos,
  resetDevServerUrlIos,
  resetNetworkSecurityExceptionsIos,
} from "../src/native/inject-dev-server-ios.js";
import { iosShellTemplatePath } from "../src/native/shell-template.js";

const BUILD_CONFIG_FIXTURE = `import Foundation

enum BuildConfig {
    #if DEBUG
    static let devServerURL = "" // WEFTER overridden per-run by the CLI
    #else
    static let devServerURL = "" // WEFTER always empty in release — never shippable
    #endif

    // WEFTER-SPLASH-CONFIG-START
    static let splashEnabled = false
    static let splashMinDurationMs: Double = 0
    static let splashMaxDurationMs: Double = 5000
    static let splashWaitForReady = true
    static let splashFadeTransition = true
    // WEFTER-SPLASH-CONFIG-END
}
`;

const INFO_PLIST_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>NSAppTransportSecurity</key>
	<dict>
		<!-- WEFTER-ATS-EXCEPTIONS-START -->
		<key>NSExceptionDomains</key>
		<dict/>
		<!-- WEFTER-ATS-EXCEPTIONS-END -->
	</dict>
</dict>
</plist>
`;

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("injectDevServerUrlIos", () => {
  it("sets the DEBUG-branch URL and leaves the release branch's empty string untouched", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-inject-"));
    const buildConfigPath = join(dir, "BuildConfig.swift");
    writeFileSync(buildConfigPath, BUILD_CONFIG_FIXTURE);

    injectDevServerUrlIos(buildConfigPath, "http://192.168.1.42:5173");

    const updated = readFileSync(buildConfigPath, "utf-8");
    expect(updated).toContain('static let devServerURL = "http://192.168.1.42:5173" // WEFTER overridden per-run by the CLI');
    expect(updated).toContain('static let devServerURL = "" // WEFTER always empty in release — never shippable');
  });

  it("survives a URL containing a double slash (the xcconfig footgun this file exists to avoid)", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-inject-"));
    const buildConfigPath = join(dir, "BuildConfig.swift");
    writeFileSync(buildConfigPath, BUILD_CONFIG_FIXTURE);

    injectDevServerUrlIos(buildConfigPath, "http://10.0.0.5:5173");

    const updated = readFileSync(buildConfigPath, "utf-8");
    expect(updated).toContain('static let devServerURL = "http://10.0.0.5:5173"');
  });
});

describe("injectDevServerUrlIos against the real shell template", () => {
  
  
  
  
  it("actually rewrites the DEBUG field in the real shells/ios-template/WefterBridge/BuildConfig.swift", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-inject-real-"));
    const buildConfigPath = join(dir, "BuildConfig.swift");
    cpSync(join(iosShellTemplatePath(), "WefterBridge/BuildConfig.swift"), buildConfigPath);

    injectDevServerUrlIos(buildConfigPath, "http://192.168.1.42:5173");

    const updated = readFileSync(buildConfigPath, "utf-8");
    expect(updated).toContain('static let devServerURL = "http://192.168.1.42:5173" // WEFTER overridden per-run by the CLI');
  });

  it("actually rewrites the ATS exception block in the real shells/ios-template/WefterBridge/Info.plist", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-inject-real-"));
    const infoPlistPath = join(dir, "Info.plist");
    cpSync(join(iosShellTemplatePath(), "WefterBridge/Info.plist"), infoPlistPath);

    injectNetworkSecurityExceptionIos(infoPlistPath, "192.168.1.42");

    const updated = readFileSync(infoPlistPath, "utf-8");
    expect(updated).toContain("<key>192.168.1.42</key>");
  });
});

describe("resetDevServerUrlIos", () => {
  it("clears a previously-injected DEBUG-branch URL back to empty, leaving release untouched", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-inject-"));
    const buildConfigPath = join(dir, "BuildConfig.swift");
    writeFileSync(buildConfigPath, BUILD_CONFIG_FIXTURE);
    injectDevServerUrlIos(buildConfigPath, "http://192.168.1.42:5173");

    resetDevServerUrlIos(buildConfigPath);

    const updated = readFileSync(buildConfigPath, "utf-8");
    expect(updated).toContain('static let devServerURL = "" // WEFTER overridden per-run by the CLI');
    expect(updated).toContain('static let devServerURL = "" // WEFTER always empty in release — never shippable');
    expect(updated).not.toContain("192.168.1.42");
  });
});

describe("injectNetworkSecurityExceptionIos", () => {
  it("adds the LAN IP as a new exception domain entry", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-inject-"));
    const plistPath = join(dir, "Info.plist");
    writeFileSync(plistPath, INFO_PLIST_FIXTURE);

    injectNetworkSecurityExceptionIos(plistPath, "192.168.1.42");

    const updated = readFileSync(plistPath, "utf-8");
    expect(updated).toContain("<key>192.168.1.42</key>");
    expect(updated).toContain("NSExceptionAllowsInsecureHTTPLoads");
  });

  it("is idempotent — running twice with the same IP doesn't duplicate the entry", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-inject-"));
    const plistPath = join(dir, "Info.plist");
    writeFileSync(plistPath, INFO_PLIST_FIXTURE);

    injectNetworkSecurityExceptionIos(plistPath, "192.168.1.42");
    injectNetworkSecurityExceptionIos(plistPath, "192.168.1.42");

    const updated = readFileSync(plistPath, "utf-8");
    const occurrences = updated.split("192.168.1.42").length - 1;
    expect(occurrences).toBe(1);
  });

  it("preserves a previously-added IP when a second, different IP is injected", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-inject-"));
    const plistPath = join(dir, "Info.plist");
    writeFileSync(plistPath, INFO_PLIST_FIXTURE);

    injectNetworkSecurityExceptionIos(plistPath, "192.168.1.42");
    injectNetworkSecurityExceptionIos(plistPath, "192.168.1.99");

    const updated = readFileSync(plistPath, "utf-8");
    expect(updated).toContain("<key>192.168.1.42</key>");
    expect(updated).toContain("<key>192.168.1.99</key>");
  });
});

describe("resetNetworkSecurityExceptionsIos", () => {
  it("empties the exception block — the release-safety counterpart to resetDevServerUrlIos", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-inject-"));
    const plistPath = join(dir, "Info.plist");
    writeFileSync(plistPath, INFO_PLIST_FIXTURE);
    injectNetworkSecurityExceptionIos(plistPath, "192.168.1.42");

    resetNetworkSecurityExceptionsIos(plistPath);

    const updated = readFileSync(plistPath, "utf-8");
    expect(updated).not.toContain("192.168.1.42");
    expect(updated).toContain("<key>NSExceptionDomains</key>\n\t\t<dict/>");
  });
});
