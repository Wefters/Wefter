import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPlugin } from "../src/commands/create-plugin.js";
import { validatePluginDirectory } from "@wefterjs/registry-codegen";

let targetDir: string;

afterEach(() => {
  if (targetDir) rmSync(targetDir, { recursive: true, force: true });
});

describe("createPlugin", () => {
  it("scaffolds every expected file with correct content", () => {
    targetDir = mkdtempSync(join(tmpdir(), "wefter-create-plugin-"));

    const dir = createPlugin(targetDir, "secure-storage");

    expect(dir).toBe(join(targetDir, "secure-storage"));
    expect(existsSync(join(dir, "package.json"))).toBe(true);
    expect(existsSync(join(dir, "plugin.json"))).toBe(true);
    expect(existsSync(join(dir, "src/index.ts"))).toBe(true);
    expect(existsSync(join(dir, "android/SecureStoragePlugin.kt"))).toBe(true);
    expect(existsSync(join(dir, "ios/SecureStoragePlugin.swift"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(true);

    const kotlin = readFileSync(join(dir, "android/SecureStoragePlugin.kt"), "utf-8");
    expect(kotlin).toContain("package dev.wefter.bridge");
    expect(kotlin).toContain("class SecureStoragePlugin(context: Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher)");
    expect(kotlin).toContain("@WefterMethod");

    const swift = readFileSync(join(dir, "ios/SecureStoragePlugin.swift"), "utf-8");
    expect(swift).toContain("final class SecureStoragePlugin: WefterPlugin");
    expect(swift).toContain("// @WefterMethod");
    expect(swift).toContain("func example(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws");

    const packageJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(packageJson.name).toBe("@yourorg/secure-storage");

    const pluginJson = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf-8"));
    expect(pluginJson.name).toBe("secure-storage");
  });

  it("PascalCases hyphenated and underscored names correctly", () => {
    targetDir = mkdtempSync(join(tmpdir(), "wefter-create-plugin-"));

    createPlugin(targetDir, "scanner");
    expect(existsSync(join(targetDir, "scanner/android/ScannerPlugin.kt"))).toBe(true);
    expect(existsSync(join(targetDir, "scanner/ios/ScannerPlugin.swift"))).toBe(true);

    createPlugin(targetDir, "secure_storage_v2");
    expect(existsSync(join(targetDir, "secure_storage_v2/android/SecureStorageV2Plugin.kt"))).toBe(true);
    expect(existsSync(join(targetDir, "secure_storage_v2/ios/SecureStorageV2Plugin.swift"))).toBe(true);
  });

  it("produces a scaffold that passes validatePluginDirectory as-is, on both platforms", () => {
    targetDir = mkdtempSync(join(tmpdir(), "wefter-create-plugin-"));

    const dir = createPlugin(targetDir, "scanner");
    const result = validatePluginDirectory(dir);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.extraction?.methods.map((m) => m.name)).toEqual(["example"]);
    expect(result.iosExtraction?.methods.map((m) => m.name)).toEqual(["example"]);
  });
});
