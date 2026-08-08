import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { copyAndroidNativeSource } from "../src/copy-native-source.js";
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
    },
  };
}

const alpha = fixturePlugin("plugin-alpha");
const beta = fixturePlugin("plugin-beta");
const noAndroid = fixturePlugin("plugin-no-android");

let destDir: string;

afterEach(() => {
  if (destDir) rmSync(destDir, { recursive: true, force: true });
});

describe("copyAndroidNativeSource", () => {
  it("copies a fixture plugin's .kt file into the destination", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-weave-"));

    copyAndroidNativeSource([alpha], destDir, "dev.wefter.bridge");

    expect(existsSync(join(destDir, "AlphaPlugin.kt"))).toBe(true);
  });

  it("copies multiple plugins' files into the same destination", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-weave-"));

    copyAndroidNativeSource([alpha, beta], destDir, "dev.wefter.bridge");

    expect(readdirSync(destDir).sort()).toEqual(["AlphaPlugin.kt", "BetaPlugin.kt"]);
  });

  it("removes a previously-copied plugin's file when that plugin is no longer installed", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-weave-"));

    copyAndroidNativeSource([alpha, beta], destDir, "dev.wefter.bridge");
    expect(readdirSync(destDir).sort()).toEqual(["AlphaPlugin.kt", "BetaPlugin.kt"]);

    copyAndroidNativeSource([alpha], destDir, "dev.wefter.bridge");

    expect(readdirSync(destDir)).toEqual(["AlphaPlugin.kt"]);
  });

  it("throws clearly, naming the plugin, when its android/ folder is missing", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-weave-"));

    expect(() => copyAndroidNativeSource([noAndroid], destDir, "dev.wefter.bridge")).toThrow(/plugin-no-android/);
  });

  it("rewrites the plugin's package declaration to the host app's namespace", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-weave-"));

    copyAndroidNativeSource([alpha], destDir, "com.example.myapp");

    const content = readFileSync(join(destDir, "AlphaPlugin.kt"), "utf-8");
    expect(content).toContain("package com.example.myapp");
    expect(content).not.toContain("package dev.wefter.bridge");
  });
});
