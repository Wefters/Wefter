import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePluginDirectory } from "../src/validate-plugin.js";

let pluginDir: string;

afterEach(() => {
  if (pluginDir) rmSync(pluginDir, { recursive: true, force: true });
});

function makePluginDir(): string {
  return mkdtempSync(join(tmpdir(), "wefter-validate-"));
}

const WELL_FORMED_KOTLIN = `
package dev.wefter.bridge

import org.json.JSONObject

class ScannerPlugin(context: android.content.Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher) {
    @WefterMethod
    fun open(payload: JSONObject, callback: (Result<Any>) -> Unit) {
        resolve(callback)
    }
}
`;

describe("validatePluginDirectory", () => {
  it("fails when there is no plugin.json at all", () => {
    pluginDir = makePluginDir();

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("No plugin.json found");
  });

  it("fails with the exact schema error when plugin.json is malformed", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ permissions: { android: "not-an-array" } }));

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("Invalid plugin.json");
  });

  it("fails when there is neither an android/ nor an ios/ directory", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "scanner" }));

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("No android/ or ios/ directory found");
  });

  it("fails with the line number for a malformed @WefterMethod signature", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "scanner" }));
    mkdirSync(join(pluginDir, "android"));
    writeFileSync(
      join(pluginDir, "android", "ScannerPlugin.kt"),
      "\n@WefterMethod\nfun open(wrongParam: String) {\n}\n"
    );

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatch(/malformed @WefterMethod.*line 2/i);
  });

  it("fails with the consistency-audit message when plugin.json's methods don't match extracted source", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "scanner", methods: ["open", "close"] }));
    mkdirSync(join(pluginDir, "android"));
    writeFileSync(join(pluginDir, "android", "ScannerPlugin.kt"), WELL_FORMED_KOTLIN);

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("close");
  });

  it("passes for a genuinely well-formed plugin and returns its extraction", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "scanner", methods: ["open"] }));
    mkdirSync(join(pluginDir, "android"));
    writeFileSync(join(pluginDir, "android", "ScannerPlugin.kt"), WELL_FORMED_KOTLIN);

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.name).toBe("scanner");
    expect(result.extraction?.methods.map((m) => m.name)).toEqual(["open"]);
    expect(result.iosExtraction).toBeUndefined();
  });
});

const WELL_FORMED_SWIFT = `
import Foundation

final class ScannerPlugin: WefterPlugin {
    // @WefterMethod
    func open(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        resolve(callback)
    }
}
`;

describe("validatePluginDirectory — iOS", () => {
  it("passes for an iOS-only plugin (no android/ directory at all)", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "scanner", methods: ["open"] }));
    mkdirSync(join(pluginDir, "ios"));
    writeFileSync(join(pluginDir, "ios", "ScannerPlugin.swift"), WELL_FORMED_SWIFT);

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(true);
    expect(result.extraction).toBeUndefined();
    expect(result.iosExtraction?.methods.map((m) => m.name)).toEqual(["open"]);
  });

  it("fails with the line number for a malformed @WefterMethod signature in ios/", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "scanner" }));
    mkdirSync(join(pluginDir, "ios"));
    writeFileSync(
      join(pluginDir, "ios", "ScannerPlugin.swift"),
      "\n// @WefterMethod\nfunc open(wrongParam: String) {\n}\n",
    );

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatch(/malformed @WefterMethod.*line 2.*\(ios\/\)/i);
  });

  it("fails with the consistency-audit message when plugin.json's methods don't match ios/ source", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "scanner", methods: ["open", "close"] }));
    mkdirSync(join(pluginDir, "ios"));
    writeFileSync(join(pluginDir, "ios", "ScannerPlugin.swift"), WELL_FORMED_SWIFT);

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("close");
  });

  it("passes and returns BOTH extractions for a plugin shipping both platforms consistently", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "scanner", methods: ["open"] }));
    mkdirSync(join(pluginDir, "android"));
    writeFileSync(join(pluginDir, "android", "ScannerPlugin.kt"), WELL_FORMED_KOTLIN);
    mkdirSync(join(pluginDir, "ios"));
    writeFileSync(join(pluginDir, "ios", "ScannerPlugin.swift"), WELL_FORMED_SWIFT);

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(true);
    expect(result.extraction?.methods.map((m) => m.name)).toEqual(["open"]);
    expect(result.iosExtraction?.methods.map((m) => m.name)).toEqual(["open"]);
  });

  it("fails when android/ is consistent but ios/ is not — each platform is audited independently", () => {
    pluginDir = makePluginDir();
    writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({ name: "scanner", methods: ["open"] }));
    mkdirSync(join(pluginDir, "android"));
    writeFileSync(join(pluginDir, "android", "ScannerPlugin.kt"), WELL_FORMED_KOTLIN);
    mkdirSync(join(pluginDir, "ios"));
    writeFileSync(
      join(pluginDir, "ios", "ScannerPlugin.swift"),
      "import Foundation\nfinal class ScannerPlugin: WefterPlugin {}\n", 
    );

    const result = validatePluginDirectory(pluginDir);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain("open");
  });
});
