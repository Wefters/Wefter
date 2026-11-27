import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatAppVersion, resolveAppVersion } from "../src/app-build/app-version.js";
import { WefterConfigSchema, type WefterConfig } from "../src/config/wefter-config-schema.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function project(packageVersion?: string): string {
  dir = mkdtempSync(join(tmpdir(), "wefter-app-version-"));
  if (packageVersion !== undefined) {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "app", version: packageVersion }));
  }
  return dir;
}

function config(extra: Record<string, unknown> = {}): WefterConfig {
  return WefterConfigSchema.parse({
    environments: { production: { appId: "com.example.app", appName: "A" } },
    ...extra,
  });
}

describe("resolveAppVersion", () => {
  it("uses version and buildNumber from the config", () => {
    const result = resolveAppVersion(project("9.9.9"), config({ version: "1.4.0", buildNumber: 42 }), {}, {});
    expect(result).toMatchObject({
      version: "1.4.0",
      buildNumber: 42,
      versionSource: "config",
      buildNumberSource: "config",
    });
  });

  it("falls back to package.json's version (cut to X.Y.Z) and build number 1", () => {
    const result = resolveAppVersion(project("2.3.4-beta.1"), config(), {}, {});
    expect(result).toMatchObject({
      version: "2.3.4",
      buildNumber: 1,
      versionSource: "package.json",
      buildNumberSource: "default",
    });
  });

  it("uses 1.0.0 when nothing gives a version", () => {
    expect(resolveAppVersion(project(), config(), {}, {}).version).toBe("1.0.0");
  });

  it("lets the command line win over the environment, and the environment over the config", () => {
    const cfg = config({ version: "1.0.0", buildNumber: 5 });
    const env = { WEFTER_APP_VERSION: "1.1.0", WEFTER_BUILD_NUMBER: "77" };

    expect(resolveAppVersion(project(), cfg, {}, env)).toMatchObject({ version: "1.1.0", buildNumber: 77 });
    expect(resolveAppVersion(project(), cfg, { appVersion: "1.2.0", buildNumber: "88" }, env)).toMatchObject({
      version: "1.2.0",
      buildNumber: 88,
      versionSource: "option",
    });
  });

  it("rejects an invalid --app-version or --build-number, naming the option", () => {
    expect(() => resolveAppVersion(project(), config(), { appVersion: "1.4" }, {})).toThrow(/--app-version "1\.4"/);
    expect(() => resolveAppVersion(project(), config(), { buildNumber: "42a" }, {})).toThrow(/--build-number "42a"/);
    expect(() => resolveAppVersion(project(), config(), { buildNumber: "0" }, {})).toThrow(/build number/);
    expect(() => resolveAppVersion(project(), config(), {}, { WEFTER_BUILD_NUMBER: "x" })).toThrow(
      /WEFTER_BUILD_NUMBER/,
    );
  });

  it("formats as the stores show it", () => {
    expect(formatAppVersion({ version: "1.4.0", buildNumber: 42 })).toBe("1.4.0 (42)");
  });
});
