import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { copyIosNativeSource } from "../src/copy-native-source-ios.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../src/__fixtures__");

function fixturePlugin(name: string): DiscoveredPlugin {
  return {
    packageDir: join(fixturesDir, name),
    manifest: {
      name,
      permissions: { android: [], ios: {} },
      nativeDependencies: {},
      hooks: [],
      events: [],
      methods: [],
    },
  };
}

const alphaIos = fixturePlugin("plugin-alpha-ios");
const betaIos = fixturePlugin("plugin-beta-ios");
const androidOnly = fixturePlugin("plugin-alpha");
const neither = fixturePlugin("plugin-no-android");

let destDir: string;

afterEach(() => {
  if (destDir) rmSync(destDir, { recursive: true, force: true });
});

describe("copyIosNativeSource", () => {
  it("copies a fixture plugin's .swift file into the destination", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-ios-weave-"));

    copyIosNativeSource([alphaIos], destDir);

    expect(existsSync(join(destDir, "AlphaPlugin.swift"))).toBe(true);
  });

  it("copies multiple plugins' files into the same destination", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-ios-weave-"));

    copyIosNativeSource([alphaIos, betaIos], destDir);

    expect(readdirSync(destDir).sort()).toEqual(["AlphaPlugin.swift", "BetaPlugin.swift"]);
  });

  it("removes a previously-copied plugin's file when that plugin is no longer installed", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-ios-weave-"));

    copyIosNativeSource([alphaIos, betaIos], destDir);
    expect(readdirSync(destDir).sort()).toEqual(["AlphaPlugin.swift", "BetaPlugin.swift"]);

    copyIosNativeSource([alphaIos], destDir);

    expect(readdirSync(destDir)).toEqual(["AlphaPlugin.swift"]);
  });

  it("silently skips a plugin with no ios/ folder — unlike Android, this is not an error", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-ios-weave-"));

    expect(() => copyIosNativeSource([androidOnly], destDir)).not.toThrow();
    expect(readdirSync(destDir)).toEqual([]);
  });

  it("silently skips a plugin with neither android/ nor ios/", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-ios-weave-"));

    expect(() => copyIosNativeSource([neither], destDir)).not.toThrow();
    expect(readdirSync(destDir)).toEqual([]);
  });

  it("does NOT rewrite anything inside the copied files — no package/namespace concept on iOS", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-ios-weave-"));

    copyIosNativeSource([alphaIos], destDir);

    const original = readFileSync(join(fixturesDir, "plugin-alpha-ios/ios/AlphaPlugin.swift"), "utf-8");
    const copied = readFileSync(join(destDir, "AlphaPlugin.swift"), "utf-8");
    expect(copied).toBe(original);
  });

  it("returns the names of plugins that actually contributed iOS source", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-ios-weave-"));

    const result = copyIosNativeSource([alphaIos, androidOnly, betaIos], destDir);

    expect(result.sort()).toEqual(["plugin-alpha-ios", "plugin-beta-ios"]);
  });
});
