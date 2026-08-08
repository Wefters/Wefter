import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { splashGenerate } from "../src/commands/splash.js";

let projectDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe("splashGenerate", () => {
  it("scaffolds a working example splash.html at the default path", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-splash-cmd-"));

    const dest = splashGenerate(projectDir);

    expect(dest).toBe(join(projectDir, "splash.html"));
    expect(existsSync(dest)).toBe(true);
    const html = readFileSync(dest, "utf-8");
    expect(html).toContain("<html>");
    expect(html).toContain("@keyframes pulse");
  });

  it("scaffolds at a custom target path", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-splash-cmd-"));

    const dest = splashGenerate(projectDir, "resources/splash.html");

    expect(dest).toBe(join(projectDir, "resources/splash.html"));
    expect(existsSync(dest)).toBe(true);
  });

  it("refuses to overwrite an existing file", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-splash-cmd-"));
    splashGenerate(projectDir);

    expect(() => splashGenerate(projectDir)).toThrow(/already exists/);
  });
});
