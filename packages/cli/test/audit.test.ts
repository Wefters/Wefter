import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { audit } from "../src/commands/audit.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixtureTestProjectDir = join(fixturesDir, "test-project");

let projectDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe("audit", () => {
  it("reports the declared plugins, their permissions, and any drift/violations — without writing anything", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-audit-"));
    cpSync(join(fixtureTestProjectDir, "plugins"), join(projectDir, "plugins"), { recursive: true });
    cpSync(join(fixtureTestProjectDir, "wefter.config.json"), join(projectDir, "wefter.config.json"));

    const result = await audit(projectDir);

    expect(result.plugins.map((p) => p.name).sort()).toEqual(["device-info", "ping-test"]);
    const deviceInfo = result.plugins.find((p) => p.name === "device-info");
    expect(deviceInfo?.permissions).toEqual(["android.permission.INTERNET"]);
    expect(result.unresolvedRegisteredPlugins).toEqual([]);
    expect(result.permissionViolations).toEqual([]);
    expect(result.lockDrift).toEqual([]);
  });

  it("surfaces a declared-but-uninstalled plugin", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-audit-"));
    cpSync(join(fixtureTestProjectDir, "plugins"), join(projectDir, "plugins"), { recursive: true });
    const rawConfig = JSON.parse(readFileSync(join(fixtureTestProjectDir, "wefter.config.json"), "utf-8"));
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({ ...rawConfig, plugins: ["device-info", "missing-plugin"] }),
    );

    const result = await audit(projectDir);

    expect(result.unresolvedRegisteredPlugins).toEqual(["missing-plugin"]);
  });
});
