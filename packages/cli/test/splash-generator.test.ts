import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateSplash } from "../src/native/splash-generator.js";

let projectDir: string;
let webAssetsDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

function setup() {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-splash-"));
  webAssetsDir = join(projectDir, "assets/www");
}

describe("generateSplash", () => {
  it("does nothing when disabled", () => {
    setup();

    generateSplash(projectDir, { enabled: false }, webAssetsDir);

    expect(existsSync(join(webAssetsDir, "splash.html"))).toBe(false);
  });

  it("copies the developer-authored splash.html into the web assets dir when enabled", () => {
    setup();
    writeFileSync(join(projectDir, "splash.html"), "<html>my splash</html>");

    generateSplash(
      projectDir,
      { enabled: true, html: "splash.html", minDurationMs: 600, fadeOutDurationMs: 300 },
      webAssetsDir
    );

    const copied = join(webAssetsDir, "splash.html");
    expect(existsSync(copied)).toBe(true);
    expect(readFileSync(copied, "utf-8")).toBe("<html>my splash</html>");
  });

  it("throws a clear error when the configured splash.html source doesn't exist", () => {
    setup();

    expect(() =>
      generateSplash(
        projectDir,
        { enabled: true, html: "missing.html", minDurationMs: 600, fadeOutDurationMs: 300 },
        webAssetsDir
      )
    ).toThrow(/not found/);
  });
});
