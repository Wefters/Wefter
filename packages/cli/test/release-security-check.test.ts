import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkReleaseSecurity } from "../src/native/release-security-check.js";
import type { WefterConfig } from "../src/config/wefter-config-schema.js";

const GRADLE_FIXTURE = (releaseDevServerUrl = "") => `dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
}

buildTypes {
    debug {
        buildConfigField("String", "DEV_SERVER_URL", "\\"http://192.168.1.5:5173\\"") // overridden per-run by the CLI
    }
    release {
        buildConfigField("String", "DEV_SERVER_URL", "\\"${releaseDevServerUrl}\\"") // always empty in release — never shippable
    }
}
`;

const NETWORK_CONFIG_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">10.0.2.2</domain>
    </domain-config>
</network-security-config>
`;

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setUpProject(
  opts: { releaseDevServerUrl?: string; hardcodedDebugging?: boolean; withDebugNetworkConfig?: boolean } = {},
): string {
  dir = mkdtempSync(join(tmpdir(), "wefter-release-check-"));
  const appDir = join(dir, ".wefter/native/android/app");

  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "build.gradle.kts"), GRADLE_FIXTURE(opts.releaseDevServerUrl ?? ""));

  const kotlinDir = join(appDir, "src/main/java/dev/wefter/bridge");
  mkdirSync(kotlinDir, { recursive: true });
  writeFileSync(
    join(kotlinDir, "MainActivity.kt"),
    opts.hardcodedDebugging
      ? "WebView.setWebContentsDebuggingEnabled(true)\n"
      : "WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)\n",
  );

  if (opts.withDebugNetworkConfig !== false) {
    const debugXmlDir = join(appDir, "src/debug/res/xml");
    mkdirSync(debugXmlDir, { recursive: true });
    writeFileSync(join(debugXmlDir, "network_security_config.xml"), NETWORK_CONFIG_FIXTURE);
  }

  return dir;
}

const baseConfig: WefterConfig = {
  plugins: [],
  pluginsDir: "node_modules",
  webDir: "dist",
  environments: { production: { appId: "com.example.app", appName: "Example" } },
  signing: { keystorePath: "./keystore.jks", keyAlias: "release" },
};

describe("checkReleaseSecurity", () => {
  it("passes when everything is in order (release DEV_SERVER_URL empty, no hardcoded debugging, debug network config present, signing + keystore present)", () => {
    const projectDir = setUpProject();
    writeFileSync(join(projectDir, "keystore.jks"), "fake keystore bytes");

    const result = checkReleaseSecurity(projectDir, baseConfig);

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("does not flag the debug buildType's DEV_SERVER_URL — only the release one matters", () => {
    const projectDir = setUpProject();
    writeFileSync(join(projectDir, "keystore.jks"), "fake keystore bytes");

    const result = checkReleaseSecurity(projectDir, baseConfig);

    expect(result.issues.some((i) => i.includes("DEV_SERVER_URL"))).toBe(false);
  });

  it("flags a non-empty release-buildType DEV_SERVER_URL", () => {
    const projectDir = setUpProject({ releaseDevServerUrl: "http://leaked:5173" });
    writeFileSync(join(projectDir, "keystore.jks"), "fake keystore bytes");

    const result = checkReleaseSecurity(projectDir, baseConfig);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("release buildType's DEV_SERVER_URL"))).toBe(true);
  });

  it("flags a hardcoded setWebContentsDebuggingEnabled(true)", () => {
    const projectDir = setUpProject({ hardcodedDebugging: true });
    writeFileSync(join(projectDir, "keystore.jks"), "fake keystore bytes");

    const result = checkReleaseSecurity(projectDir, baseConfig);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("Hardcoded"))).toBe(true);
  });

  it("flags a missing debug network security config", () => {
    const projectDir = setUpProject({ withDebugNetworkConfig: false });
    writeFileSync(join(projectDir, "keystore.jks"), "fake keystore bytes");

    const result = checkReleaseSecurity(projectDir, baseConfig);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("network security config"))).toBe(true);
  });

  it("flags a missing signing config", () => {
    const projectDir = setUpProject();

    const result = checkReleaseSecurity(projectDir, { ...baseConfig, signing: undefined });

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("signing config"))).toBe(true);
  });

  it("flags a signing config whose keystore file doesn't exist on disk", () => {
    const projectDir = setUpProject();

    const result = checkReleaseSecurity(projectDir, baseConfig);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes("keystore not found"))).toBe(true);
  });
});
