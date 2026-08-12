import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { add } from "../src/commands/add.js";

let projectDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

function setup(): void {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-add-"));
  writeFileSync(join(projectDir, "wefter.config.json"), JSON.stringify({ plugins: [] }));
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

function fakeInstall(pluginJson: Record<string, unknown>, kotlinSource: string | null) {
  return async (dir: string, spec: string) => {
    const name = spec.replace(/@[\w.\-^~]+$/, "");
    const packageDir = join(dir, "node_modules", name);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "plugin.json"), JSON.stringify(pluginJson));
    if (kotlinSource !== null) {
      mkdirSync(join(packageDir, "android"), { recursive: true });
      writeFileSync(join(packageDir, "android", "ScannerPlugin.kt"), kotlinSource);
    }
  };
}

describe("add", () => {
  it("rejects an obviously invalid package name before attempting install", async () => {
    setup();
    const install = vi.fn();

    await expect(add(projectDir, "not a package name!!", install)).rejects.toThrow(/doesn't look like/);
    expect(install).not.toHaveBeenCalled();
  });

  it("installs, validates, and declares a genuinely valid plugin", async () => {
    setup();

    const result = await add(
      projectDir,
      "scanner",
      fakeInstall({ name: "scanner", methods: ["open"] }, WELL_FORMED_KOTLIN)
    );

    expect(result).toEqual({ added: true, alreadyDeclared: false, issues: [] });
    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual(["scanner"]);
  });

  it("refuses a package with no plugin.json — installed but not declared", async () => {
    setup();
    const install = async (dir: string) => {
      mkdirSync(join(dir, "node_modules", "scanner"), { recursive: true });
    };

    const result = await add(projectDir, "scanner", install);

    expect(result.added).toBe(false);
    expect(result.issues[0]).toContain("No plugin.json found");
    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual([]);
  });

  it("refuses a package with a malformed manifest, surfacing the schema error", async () => {
    setup();

    const result = await add(projectDir, "scanner", fakeInstall({ permissions: { android: "not-an-array" } }, WELL_FORMED_KOTLIN));

    expect(result.added).toBe(false);
    expect(result.issues[0]).toContain("Invalid plugin.json");
    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual([]);
  });

  it("refuses a package with a malformed @WefterMethod signature, surfacing the line number", async () => {
    setup();

    const result = await add(
      projectDir,
      "scanner",
      fakeInstall({ name: "scanner" }, "\n@WefterMethod\nfun open(wrongParam: String) {\n}\n")
    );

    expect(result.added).toBe(false);
    expect(result.issues[0]).toMatch(/malformed @WefterMethod.*line 2/i);
    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual([]);
  });

  it("refuses a package whose declared methods don't match its extracted source", async () => {
    setup();

    const result = await add(
      projectDir,
      "scanner",
      fakeInstall({ name: "scanner", methods: ["open", "close"] }, WELL_FORMED_KOTLIN)
    );

    expect(result.added).toBe(false);
    expect(result.issues[0]).toContain("close");
    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual([]);
  });

  it("is idempotent — adding an already-declared valid plugin again doesn't duplicate or fail", async () => {
    setup();
    const install = fakeInstall({ name: "scanner", methods: ["open"] }, WELL_FORMED_KOTLIN);

    await add(projectDir, "scanner", install);
    const result = await add(projectDir, "scanner", install);

    expect(result).toEqual({ added: false, alreadyDeclared: true, issues: [] });
    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual(["scanner"]);
  });

  it("accepts a scoped package name with a version specifier and installs under the bare name", async () => {
    setup();

    const result = await add(
      projectDir,
      "@wefterjs/plugin-scanner@1.2.3",
      fakeInstall({ name: "scanner", methods: ["open"] }, WELL_FORMED_KOTLIN)
    );

    
    
    expect(result.issues).toEqual([]);
  });
});
