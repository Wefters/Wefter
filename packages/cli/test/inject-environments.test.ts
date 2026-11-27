import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { injectEnvironmentConfig } from "@wefterjs/registry-codegen";
import { ensureAndroidFlavors, ensureIosConfigurations } from "../src/native/inject-environments.js";
import { injectEnvironmentConfigIos } from "../src/native/inject-environment-ios.js";

const shells = join(dirname(fileURLToPath(import.meta.url)), "../../../shells");
let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("ensureAndroidFlavors", () => {
  it("adds a flavor sync can fill in for a new environment, once", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-envs-android-"));
    const gradle = join(dir, "build.gradle.kts");
    cpSync(join(shells, "android-template/app/build.gradle.kts"), gradle);

    expect(ensureAndroidFlavors(gradle, ["development", "staging", "production"])).toEqual(["staging"]);
    expect(ensureAndroidFlavors(gradle, ["development", "staging", "production"])).toEqual([]);

    injectEnvironmentConfig(gradle, "staging", { appId: "com.example.shop.staging", appName: "Shop (Staging)" });
    const contents = readFileSync(gradle, "utf-8");
    expect(contents.match(/create\("staging"\)/g)).toHaveLength(1);
    expect(contents).toContain('applicationId = "com.example.shop.staging"');
    expect(contents.indexOf('create("staging")')).toBeLessThan(contents.indexOf("signingConfigs"));
  });
});

describe("ensureIosConfigurations", () => {
  it("adds Debug-<Env> and Release-<Env> configurations with their xcconfig files, once", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-envs-ios-"));
    cpSync(join(shells, "ios-template"), dir, { recursive: true });
    const pbxproj = join(dir, "WefterBridge.xcodeproj/project.pbxproj");
    const configDir = join(dir, "Config");
    const before = readFileSync(pbxproj, "utf-8");

    expect(ensureIosConfigurations(pbxproj, configDir, ["development", "production", "staging"])).toEqual(["staging"]);
    expect(ensureIosConfigurations(pbxproj, configDir, ["staging"])).toEqual([]);

    const after = readFileSync(pbxproj, "utf-8");
    expect(after.match(/name = "Release-Staging";/g)).toHaveLength(2);
    expect(after.match(/name = "Debug-Staging";/g)).toHaveLength(2);
    expect(after).toContain('path = "Release-Staging.xcconfig"');
    expect((after.match(/\{/g) ?? []).length - (after.match(/\}/g) ?? []).length).toBe(
      (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length,
    );
    expect(readFileSync(join(configDir, "Release-Staging.xcconfig"), "utf-8")).toContain(
      '#include "Environment-staging.xcconfig"',
    );
    expect(existsSync(join(configDir, "Environment-staging.xcconfig"))).toBe(true);
    injectEnvironmentConfigIos(join(configDir, "Environment-staging.xcconfig"), {
      bundleId: "com.example.s",
      appName: "S",
    });
  });
});
