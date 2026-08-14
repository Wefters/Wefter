import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReleaseReadinessChecks } from "../src/doctor/release-readiness.js";
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

describe("runReleaseReadinessChecks", () => {
  it("fails clearly on a project with no signing config at all", async () => {
    const projectDir = setUpProject();
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({ environments: { production: { appId: "com.example.app", appName: "Example" } } }),
    );

    const results = await runReleaseReadinessChecks(projectDir);

    const signingCheck = results.find((r) => r.name === "Signing config");
    expect(signingCheck?.passed).toBe(false);
  });

  it("passes every check when the project is fully release-ready on both platforms", async () => {
    const projectDir = setUpProject();
    writeFileSync(join(projectDir, "keystore.jks"), "fake keystore bytes");
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({
        environments: { production: { appId: "com.example.app", appName: "Example" } },
        signing: { keystorePath: "./keystore.jks", keyAlias: "release" },
        iosSigning: { teamId: "ABCDE12345" },
      }),
    );
    process.env.WEFTER_KEYSTORE_PASSWORD = "hunter2";
    process.env.WEFTER_IOS_SIGNING_IDENTITY = "Apple Distribution: Example Inc (ABCDE12345)";

    const results = await runReleaseReadinessChecks(projectDir);

    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("flags a missing WEFTER_KEYSTORE_PASSWORD even when the keystore file itself is present", async () => {
    const projectDir = setUpProject();
    writeFileSync(join(projectDir, "keystore.jks"), "fake keystore bytes");
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({
        environments: { production: { appId: "com.example.app", appName: "Example" } },
        signing: { keystorePath: "./keystore.jks", keyAlias: "release" },
      }),
    );

    const results = await runReleaseReadinessChecks(projectDir);

    const passwordCheck = results.find((r) => r.name === "WEFTER_KEYSTORE_PASSWORD set");
    expect(passwordCheck?.passed).toBe(false);
  });
});

describe("runReleaseReadinessChecks — iOS", () => {
  it("fails clearly on a project with no iosSigning config at all", async () => {
    const projectDir = setUpProject();
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({ environments: { production: { appId: "com.example.app", appName: "Example" } } }),
    );

    const results = await runReleaseReadinessChecks(projectDir);

    const iosSigningCheck = results.find((r) => r.name === "iOS signing config");
    expect(iosSigningCheck?.passed).toBe(false);
  });

  it("flags a missing WEFTER_IOS_SIGNING_IDENTITY even when iosSigning is configured", async () => {
    const projectDir = setUpProject();
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({
        environments: { production: { appId: "com.example.app", appName: "Example" } },
        iosSigning: { teamId: "ABCDE12345" },
      }),
    );

    const results = await runReleaseReadinessChecks(projectDir);

    const identityCheck = results.find((r) => r.name === "WEFTER_IOS_SIGNING_IDENTITY set");
    expect(identityCheck?.passed).toBe(false);
  });

  it("flags the iOS release security lint when the iOS native project is missing entirely", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-release-readiness-"));
    writeFileSync(
      join(dir, "wefter.config.json"),
      JSON.stringify({
        environments: { production: { appId: "com.example.app", appName: "Example" } },
        iosSigning: { teamId: "ABCDE12345" },
      }),
    );

    const results = await runReleaseReadinessChecks(dir);

    const lintCheck = results.find((r) => r.name === "iOS release security lint");
    expect(lintCheck?.passed).toBe(false);
    expect(lintCheck?.detail).toContain("iOS native project not found");
  });
});
