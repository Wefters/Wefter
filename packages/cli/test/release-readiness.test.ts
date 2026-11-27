import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReleaseReadinessChecks } from "../src/doctor/release-readiness.js";
import { allPassed } from "../src/doctor/report.js";
import { iosAppDir } from "../src/config/project-paths.js";

const GRADLE_FIXTURE = `buildTypes {
    debug {
        buildConfigField("String", "DEV_SERVER_URL", "\\"\\"") // overridden per-run by the CLI
    }
    release {
        buildConfigField("String", "DEV_SERVER_URL", "\\"\\"") // always empty in release — never shippable
    }
}
`;

const IOS_BUILD_CONFIG_FIXTURE = `enum BuildConfig {
    #if DEBUG
    static let devServerURL = "" // WEFTER overridden per-run by the CLI
    #else
    static let devServerURL = "" // WEFTER always empty in release — never shippable
    #endif
}
`;

const IOS_INFO_PLIST_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
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
const originalPassword = process.env.WEFTER_KEYSTORE_PASSWORD;
const originalIosIdentity = process.env.WEFTER_IOS_SIGNING_IDENTITY;

beforeEach(() => {
  delete process.env.WEFTER_KEYSTORE_PASSWORD;
  delete process.env.WEFTER_IOS_SIGNING_IDENTITY;
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (originalPassword === undefined) delete process.env.WEFTER_KEYSTORE_PASSWORD;
  else process.env.WEFTER_KEYSTORE_PASSWORD = originalPassword;
  if (originalIosIdentity === undefined) delete process.env.WEFTER_IOS_SIGNING_IDENTITY;
  else process.env.WEFTER_IOS_SIGNING_IDENTITY = originalIosIdentity;
});

function setUpProject(): string {
  dir = mkdtempSync(join(tmpdir(), "wefter-release-readiness-"));
  const appDir = join(dir, ".wefter/native/android/app");
  mkdirSync(join(appDir, "src/debug/res/xml"), { recursive: true });
  mkdirSync(join(appDir, "src/main/java/dev/wefter/bridge"), { recursive: true });
  writeFileSync(join(appDir, "build.gradle.kts"), GRADLE_FIXTURE);
  writeFileSync(join(appDir, "src/debug/res/xml/network_security_config.xml"), "<network-security-config/>");
  writeFileSync(
    join(appDir, "src/main/java/dev/wefter/bridge/MainActivity.kt"),
    "WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)\n",
  );

  const iosApp = iosAppDir(dir);
  mkdirSync(iosApp, { recursive: true });
  writeFileSync(join(iosApp, "BuildConfig.swift"), IOS_BUILD_CONFIG_FIXTURE);
  writeFileSync(join(iosApp, "Info.plist"), IOS_INFO_PLIST_FIXTURE);

  return dir;
}

/** Writes `wefter.config.json` and a built web app (`dist/index.html`, plus `extraWebFiles`). */
function writeProjectConfig(config: Record<string, unknown>, extraWebFiles: Record<string, string> = {}): void {
  writeFileSync(join(dir, "wefter.config.json"), JSON.stringify(config));
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist/index.html"), "<!doctype html><title>App</title>");
  for (const [name, contents] of Object.entries(extraWebFiles)) writeFileSync(join(dir, "dist", name), contents);
}

const PRODUCTION = { production: { appId: "com.example.shop", appName: "Shop" } };

const READY_SIGNING = {
  android: { keystorePath: "release.jks", keyAlias: "release", storePassword: "${WEFTER_KEYSTORE_PASSWORD}" },
  ios: { teamId: "ABCDE12345" },
};

describe("runReleaseReadinessChecks", () => {
  it("fails when there is no production environment, which release builds use", async () => {
    setUpProject();
    writeProjectConfig({ environments: { development: { appId: "com.example.dev", appName: "Dev" } } });

    const results = await runReleaseReadinessChecks(dir);

    expect(allPassed(results)).toBe(false);
    expect(results[0].name).toContain('"production" environment');
  });

  it("fails clearly on a project with no signing config at all, on both platforms", async () => {
    setUpProject();
    writeProjectConfig({ environments: PRODUCTION, version: "1.0.0" });

    const results = await runReleaseReadinessChecks(dir);
    const failed = results.filter((r) => !r.passed).map((r) => r.name);

    expect(failed.some((n) => n.startsWith("Android:") && n.includes("signing"))).toBe(true);
    expect(failed.some((n) => n.startsWith("iOS:") && n.includes("signing"))).toBe(true);
  });

  it("passes when the project is release-ready on both platforms; store notes are warnings only", async () => {
    setUpProject();
    writeFileSync(join(dir, "release.jks"), "fake keystore");
    process.env.WEFTER_KEYSTORE_PASSWORD = "hunter2";
    writeProjectConfig({ environments: PRODUCTION, version: "1.2.0", buildNumber: 7, signing: READY_SIGNING });

    const results = await runReleaseReadinessChecks(dir);

    expect(results.filter((r) => !r.passed)).toEqual([]);
    expect(allPassed(results)).toBe(true);
    expect(results.find((r) => r.name === "App version")?.detail).toBe("1.2.0 (7)");
    expect(results.some((r) => r.warning && r.name.startsWith("iOS:"))).toBe(true);
  });

  it("flags a missing keystore password even when the keystore file itself is present", async () => {
    setUpProject();
    writeFileSync(join(dir, "release.jks"), "fake keystore");
    writeProjectConfig({ environments: PRODUCTION, version: "1.0.0", signing: READY_SIGNING });

    const results = await runReleaseReadinessChecks(dir);

    expect(results.some((r) => !r.passed && r.name.includes("WEFTER_KEYSTORE_PASSWORD"))).toBe(true);
  });

  it("fails on the template's app id and reports web app problems as warnings", async () => {
    setUpProject();
    writeFileSync(join(dir, "release.jks"), "fake keystore");
    process.env.WEFTER_KEYSTORE_PASSWORD = "hunter2";
    writeProjectConfig(
      {
        environments: { production: { appId: "dev.wefter.bridge", appName: "Shop" } },
        version: "1.0.0",
        signing: READY_SIGNING,
      },
      {
        "index.js.map": "{}",
        "page.html": '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
        "api.js": 'fetch("http://192.168.1.20:3000/api")',
      },
    );

    const results = await runReleaseReadinessChecks(dir, { platforms: ["android"] });
    const failed = results.filter((r) => !r.passed).map((r) => r.name);
    const warnings = results.filter((r) => r.warning).map((r) => r.name);

    expect(failed.some((n) => n.includes("template's app id"))).toBe(true);
    expect(warnings.some((n) => n.includes("source map"))).toBe(true);
    expect(warnings.some((n) => n.includes("fonts.googleapis.com"))).toBe(true);
    expect(warnings.some((n) => n.includes("192.168.1.20"))).toBe(true);
  });

  it("flags the iOS release security lint when the iOS native project is missing entirely", async () => {
    setUpProject();
    rmSync(iosAppDir(dir), { recursive: true, force: true });
    writeProjectConfig({ environments: PRODUCTION, version: "1.0.0", signing: READY_SIGNING });

    const results = await runReleaseReadinessChecks(dir, { platforms: ["ios"] });

    expect(results.some((r) => !r.passed && r.name.includes("iOS native project not found"))).toBe(true);
  });
});
