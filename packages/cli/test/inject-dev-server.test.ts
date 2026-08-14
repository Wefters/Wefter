import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  injectDevServerUrl,
  injectNetworkSecurityException,
  resetDevServerUrl,
} from "../src/native/inject-dev-server.js";
import { shellTemplatePath } from "../src/native/shell-template.js";

const GRADLE_FIXTURE = `dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
}

buildTypes {
    debug {
        buildConfigField("String", "DEV_SERVER_URL", "\\"\\"") // overridden per-run by the CLI
    }
    release {
        buildConfigField("String", "DEV_SERVER_URL", "\\"\\"") // always empty in release — never shippable
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

describe("injectDevServerUrl", () => {
  it("sets the debug field's URL and leaves the release field's empty string untouched", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-inject-"));
    const gradlePath = join(dir, "build.gradle.kts");
    writeFileSync(gradlePath, GRADLE_FIXTURE);

    injectDevServerUrl(gradlePath, "http://192.168.1.42:5173");

    const updated = readFileSync(gradlePath, "utf-8");
    expect(updated).toContain('buildConfigField("String", "DEV_SERVER_URL", "\\"http://192.168.1.42:5173\\"")');
    expect(updated).toContain('release {\n        buildConfigField("String", "DEV_SERVER_URL", "\\"\\"")');
  });
});

describe("injectDevServerUrl against the real shell template", () => {
  it("actually rewrites the debug field, not just a hand-rolled fixture", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-inject-real-"));
    const gradlePath = join(dir, "build.gradle.kts");
    cpSync(join(shellTemplatePath(), "app/build.gradle.kts"), gradlePath);

    injectDevServerUrl(gradlePath, "http://192.168.1.42:5173");

    const updated = readFileSync(gradlePath, "utf-8");
    expect(updated).toContain('buildConfigField("String", "DEV_SERVER_URL", "\\"http://192.168.1.42:5173\\"")');
  });
});

describe("resetDevServerUrl", () => {
  it("clears a previously-injected debug URL back to empty, leaving release untouched", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-inject-"));
    const gradlePath = join(dir, "build.gradle.kts");
    writeFileSync(gradlePath, GRADLE_FIXTURE);
    injectDevServerUrl(gradlePath, "http://192.168.1.42:5173");

    resetDevServerUrl(gradlePath);

    const updated = readFileSync(gradlePath, "utf-8");
    expect(updated).toContain('debug {\n        buildConfigField("String", "DEV_SERVER_URL", "\\"\\"")');
    expect(updated).toContain('release {\n        buildConfigField("String", "DEV_SERVER_URL", "\\"\\"")');
    expect(updated).not.toContain("192.168.1.42");
  });
});

describe("injectNetworkSecurityException", () => {
  it("adds the LAN IP as a new domain entry, preserving the existing one", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-inject-"));
    const configPath = join(dir, "network_security_config.xml");
    writeFileSync(configPath, NETWORK_CONFIG_FIXTURE);

    injectNetworkSecurityException(configPath, "192.168.1.42");

    const updated = readFileSync(configPath, "utf-8");
    expect(updated).toContain(">10.0.2.2<");
    expect(updated).toContain(">192.168.1.42<");
  });

  it("is idempotent — running twice with the same IP doesn't duplicate the entry", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-inject-"));
    const configPath = join(dir, "network_security_config.xml");
    writeFileSync(configPath, NETWORK_CONFIG_FIXTURE);

    injectNetworkSecurityException(configPath, "192.168.1.42");
    injectNetworkSecurityException(configPath, "192.168.1.42");

    const updated = readFileSync(configPath, "utf-8");
    const occurrences = updated.split("192.168.1.42").length - 1;
    expect(occurrences).toBe(1);
  });
});
