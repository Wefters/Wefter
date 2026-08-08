import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { copyWebAssets } from "../src/copy-web-assets.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../src/__fixtures__");

let destDir: string;
let sourceProjectDir: string;

afterEach(() => {
  if (destDir) rmSync(destDir, { recursive: true, force: true });
  if (sourceProjectDir) rmSync(sourceProjectDir, { recursive: true, force: true });
});

describe("copyWebAssets", () => {
  it("copies index.html and other files from webDir into the destination", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-web-"));

    copyWebAssets(fixturesDir, "web-valid", destDir);

    expect(existsSync(join(destDir, "index.html"))).toBe(true);
    expect(readFileSync(join(destDir, "main.js"), "utf-8")).toContain("fixture web asset");
  });

  it("clears previously-copied stale files before copying the new set", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-web-"));
    sourceProjectDir = mkdtempSync(join(tmpdir(), "wefter-web-src-"));
    cpSync(join(fixturesDir, "web-valid"), join(sourceProjectDir, "web-valid"), { recursive: true });

    copyWebAssets(sourceProjectDir, "web-valid", destDir);
    expect(existsSync(join(destDir, "main.js"))).toBe(true);

    rmSync(join(sourceProjectDir, "web-valid", "main.js"), { force: true });
    copyWebAssets(sourceProjectDir, "web-valid", destDir);

    expect(existsSync(join(destDir, "main.js"))).toBe(false);
  });

  it("throws when webDir does not exist", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-web-"));

    expect(() => copyWebAssets(fixturesDir, "does-not-exist", destDir)).toThrow(/webDir "does-not-exist" not found/);
  });

  it("throws when webDir exists but has no index.html", () => {
    destDir = mkdtempSync(join(tmpdir(), "wefter-web-"));

    expect(() => copyWebAssets(fixturesDir, "web-no-index", destDir)).toThrow(/No index\.html found/);
  });
});
