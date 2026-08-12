import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../src/plugins/registry.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function writePluginPackage(pluginsDir: string, packageName: string, manifestName: string): void {
  const packageDir = join(pluginsDir, packageName);
  mkdirSync(join(packageDir, "android"), { recursive: true });
  writeFileSync(join(packageDir, "plugin.json"), JSON.stringify({ name: manifestName }));
  writeFileSync(join(packageDir, "android", "Plugin.kt"), "package dev.wefter.bridge\n\nclass Plugin\n");
}

describe("resolveRegisteredPlugins", () => {
  it("resolves exactly the given package names, ignoring anything else installed", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-registry-"));
    writePluginPackage(dir, "@wefterjs/plugin-device-info", "device-info");
    writePluginPackage(dir, "@wefterjs/plugin-ping-test", "ping-test");

    const plugins = resolveRegisteredPlugins(dir, ["@wefterjs/plugin-device-info"]);

    expect(plugins.map((p) => p.manifest.name)).toEqual(["device-info"]);
  });

  it("silently drops a registered name that's no longer installed", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-registry-"));
    writePluginPackage(dir, "@wefterjs/plugin-device-info", "device-info");

    const plugins = resolveRegisteredPlugins(dir, ["@wefterjs/plugin-device-info", "@wefterjs/plugin-removed"]);

    expect(plugins.map((p) => p.manifest.name)).toEqual(["device-info"]);
  });
});

describe("unresolvedRegisteredPlugins", () => {
  it("flags registered names that don't resolve to an installed package", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-registry-"));
    writePluginPackage(dir, "@wefterjs/plugin-device-info", "device-info");

    expect(unresolvedRegisteredPlugins(dir, ["@wefterjs/plugin-device-info", "@wefterjs/plugin-removed"])).toEqual([
      "@wefterjs/plugin-removed",
    ]);
  });

  it("is empty when every registered name resolves", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-registry-"));
    writePluginPackage(dir, "@wefterjs/plugin-device-info", "device-info");

    expect(unresolvedRegisteredPlugins(dir, ["@wefterjs/plugin-device-info"])).toEqual([]);
  });
});
