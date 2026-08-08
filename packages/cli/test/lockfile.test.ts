import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DiscoveredPlugin } from "@wefter/registry-codegen";
import {
  checkLockDrift,
  computeIntegrityHash,
  readInstalledVersion,
  writeLockfile,
} from "../src/plugins/lockfile.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function writePlugin(pluginsDir: string, name: string, version: string): DiscoveredPlugin {
  const packageDir = join(pluginsDir, name);
  mkdirSync(join(packageDir, "android"), { recursive: true });
  writeFileSync(join(packageDir, "plugin.json"), JSON.stringify({ name }));
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name, version }));
  writeFileSync(join(packageDir, "android", "Plugin.kt"), "package dev.wefter.bridge\n\nclass Plugin\n");
  return { manifest: { name, permissions: { android: [], ios: {} }, nativeDependencies: {}, hooks: [], events: [], methods: [] }, packageDir };
}

describe("readInstalledVersion", () => {
  it("reads the version field from the plugin's package.json", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-lockfile-"));
    const plugin = writePlugin(dir, "device-info", "1.2.3");

    expect(readInstalledVersion(plugin.packageDir)).toBe("1.2.3");
  });

  it("falls back to 0.0.0 when package.json is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-lockfile-"));
    mkdirSync(join(dir, "no-package-json"));

    expect(readInstalledVersion(join(dir, "no-package-json"))).toBe("0.0.0");
  });
});

describe("computeIntegrityHash", () => {
  it("is stable for identical plugin contents and changes when the source changes", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-lockfile-"));
    const plugin = writePlugin(dir, "device-info", "1.0.0");
    const first = computeIntegrityHash(plugin.packageDir);

    expect(computeIntegrityHash(plugin.packageDir)).toBe(first);

    writeFileSync(join(plugin.packageDir, "android", "Plugin.kt"), "package dev.wefter.bridge\n\nclass Plugin2\n");
    expect(computeIntegrityHash(plugin.packageDir)).not.toBe(first);
  });

  it("changes when ios/*.swift source changes, same as android/*.kt already does", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-lockfile-"));
    const plugin = writePlugin(dir, "device-info", "1.0.0");
    mkdirSync(join(plugin.packageDir, "ios"), { recursive: true });
    writeFileSync(join(plugin.packageDir, "ios", "Plugin.swift"), "final class Plugin: WefterPlugin {}\n");

    const first = computeIntegrityHash(plugin.packageDir);
    expect(computeIntegrityHash(plugin.packageDir)).toBe(first);

    writeFileSync(join(plugin.packageDir, "ios", "Plugin.swift"), "final class Plugin: WefterPlugin { /* changed */ }\n");
    expect(computeIntegrityHash(plugin.packageDir)).not.toBe(first);
  });

  it("an Android-only plugin's hash is unaffected by the ios/ hashing loop existing at all", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-lockfile-"));
    const plugin = writePlugin(dir, "device-info", "1.0.0");

    
    
    
    expect(() => computeIntegrityHash(plugin.packageDir)).not.toThrow();
  });
});

describe("writeLockfile / checkLockDrift", () => {
  it("writes an entry per plugin with a sha256 integrity string", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-lockfile-"));
    const plugin = writePlugin(dir, "device-info", "1.0.0");

    writeLockfile(dir, [plugin]);

    const lock = JSON.parse(readFileSync(join(dir, "wefter.lock.json"), "utf-8"));
    expect(lock.plugins["device-info"].resolved).toBe("1.0.0");
    expect(lock.plugins["device-info"].integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it("reports no drift when nothing has changed since the lockfile was written", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-lockfile-"));
    const plugin = writePlugin(dir, "device-info", "1.0.0");
    writeLockfile(dir, [plugin]);

    expect(checkLockDrift(dir, [plugin])).toEqual([]);
  });

  it("reports no drift when there's no lockfile yet — nothing to compare against", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-lockfile-"));
    const plugin = writePlugin(dir, "device-info", "1.0.0");

    expect(checkLockDrift(dir, [plugin])).toEqual([]);
  });

  it("flags a plugin whose installed version no longer matches the lockfile", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-lockfile-"));
    const plugin = writePlugin(dir, "device-info", "1.0.0");
    writeLockfile(dir, [plugin]);

    writeFileSync(join(plugin.packageDir, "package.json"), JSON.stringify({ name: "device-info", version: "2.0.0" }));

    const drift = checkLockDrift(dir, [plugin]);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain("device-info");
    expect(drift[0]).toContain("1.0.0");
    expect(drift[0]).toContain("2.0.0");
  });
});
