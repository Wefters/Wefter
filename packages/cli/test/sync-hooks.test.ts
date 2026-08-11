import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { sync } from "../src/commands/sync.js";
import { androidGeneratedRegistryPath, loadWefterConfig } from "../src/config/project-paths.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixtureTestProjectDir = join(fixturesDir, "test-project");
const brokenProjectFixtureDir = join(fixturesDir, "broken-project");

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-synchooks-"));
  cpSync(join(fixtureTestProjectDir, "plugins"), join(projectDir, "plugins"), { recursive: true });
  cpSync(join(fixtureTestProjectDir, "wefter.config.json"), join(projectDir, "wefter.config.json"));
  cpSync(join(fixtureTestProjectDir, "web"), join(projectDir, "web"), { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("sync() hooks — real npm scripts, real subprocess", () => {
  it("runs wefter:sync:before, and aborts sync's real work when it fails", async () => {
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { "wefter:sync:before": "node -e \"process.exit(1)\"" } }),
    );

    await expect(sync(projectDir)).rejects.toThrow('Hook "wefter:sync:before" exited with code 1');

    const config = loadWefterConfig(projectDir);
    const outFile = androidGeneratedRegistryPath(projectDir, config);
    expect(existsSync(outFile)).toBe(false);
  });

  it("runs wefter:sync:before to completion before sync's real work, then wefter:sync:after only once real work succeeded", async () => {
    const beforeMarker = join(projectDir, "before-ran.txt");
    const afterMarker = join(projectDir, "after-ran.txt");
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: {
          "wefter:sync:before": `node -e "require('fs').writeFileSync('${beforeMarker.replace(/\\/g, "\\\\")}', 'ran')"`,
          "wefter:sync:after": `node -e "require('fs').writeFileSync('${afterMarker.replace(/\\/g, "\\\\")}', 'ran')"`,
        },
      }),
    );

    await sync(projectDir);

    expect(existsSync(beforeMarker)).toBe(true);
    expect(existsSync(afterMarker)).toBe(true);

    const config = loadWefterConfig(projectDir);
    const outFile = androidGeneratedRegistryPath(projectDir, config);
    expect(existsSync(outFile)).toBe(true);
  });

  it("does not run wefter:sync:after if sync's real work fails", async () => {
    const brokenDir = mkdtempSync(join(tmpdir(), "wefter-synchooks-broken-"));
    cpSync(join(brokenProjectFixtureDir, "plugins"), join(brokenDir, "node_modules"), { recursive: true });
    const afterMarker = join(brokenDir, "after-ran.txt");
    writeFileSync(
      join(brokenDir, "wefter.config.json"),
      JSON.stringify({
        environments: { production: { appId: "com.example.app", appName: "Example" } },
        plugins: ["bad-plugin"],
      }),
    );
    writeFileSync(
      join(brokenDir, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: {
          "wefter:sync:after": `node -e "require('fs').writeFileSync('${afterMarker.replace(/\\/g, "\\\\")}', 'ran')"`,
        },
      }),
    );

    try {
      await expect(sync(brokenDir)).rejects.toThrow(/bad-plugin/);
      expect(existsSync(afterMarker)).toBe(false);
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  });

  it("exposes WEFTER_COMMAND, WEFTER_PHASE, and WEFTER_PROJECT_DIR to a real hook script", async () => {
    const envDump = join(projectDir, "env-dump.json");
    const hookScript = join(projectDir, "dump-env.js");
    writeFileSync(
      hookScript,
      `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(envDump)}, JSON.stringify({\n  command: process.env.WEFTER_COMMAND,\n  phase: process.env.WEFTER_PHASE,\n  projectDir: process.env.WEFTER_PROJECT_DIR,\n}));\n`,
    );
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { "wefter:sync:before": `node ${JSON.stringify(hookScript)}` } }),
    );

    await sync(projectDir);

    const dumped = JSON.parse(readFileSync(envDump, "utf-8"));
    expect(dumped).toEqual({ command: "sync", phase: "before", projectDir });
  });

  it("does nothing when no hook scripts are defined", async () => {
    await expect(sync(projectDir)).resolves.toBeTruthy();
  });
});
