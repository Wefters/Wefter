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
  it("scaffolds a working example splash folder at the default path", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-splash-cmd-"));

    const dest = splashGenerate(projectDir);

    expect(dest).toBe(join(projectDir, "splash"));
    expect(existsSync(join(dest, "index.html"))).toBe(true);
    expect(existsSync(join(dest, "styles.css"))).toBe(true);
    const html = readFileSync(join(dest, "index.html"), "utf-8");
    expect(html).toContain("<html>");
    expect(html).toContain('href="./styles.css"');
    const css = readFileSync(join(dest, "styles.css"), "utf-8");
    expect(css).toContain("@keyframes pulse");
  });

  it("scaffolds at a custom target path", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-splash-cmd-"));

    const dest = splashGenerate(projectDir, "resources/splash");

    expect(dest).toBe(join(projectDir, "resources/splash"));
    expect(existsSync(join(dest, "index.html"))).toBe(true);
  });

  it("refuses to overwrite an existing folder", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-splash-cmd-"));
    splashGenerate(projectDir);

    expect(() => splashGenerate(projectDir)).toThrow(/already exists/);
  });
});
