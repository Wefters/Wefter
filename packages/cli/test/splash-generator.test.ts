import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateSplash } from "../src/native/splash-generator.js";
import { setTerminalStreams } from "../src/ui/terminal.js";

/** Captures what the CLI writes to stderr (warnings) instead of printing it. */
function captureStderr(): { text: () => string; restore: () => void } {
  let err = "";
  setTerminalStreams({ out: () => {}, err: (chunk) => (err += chunk), columns: () => 80 });
  return { text: () => err, restore: () => setTerminalStreams(null) };
}

let projectDir: string;
let webAssetsDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

function setup() {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-splash-"));
  webAssetsDir = join(projectDir, "assets/www");
}

function resolved(
  overrides: Partial<{
    source: string;
    minDuration: number;
    maxDuration: number;
    dismissOn: "ready" | "timer";
    transition: "fade" | "none";
  }> = {},
) {
  return {
    enabled: true as const,
    source: "splash",
    minDuration: 0,
    maxDuration: 5000,
    dismissOn: "ready" as const,
    transition: "fade" as const,
    ...overrides,
  };
}

describe("generateSplash", () => {
  it("does nothing when disabled", () => {
    setup();

    generateSplash(projectDir, { enabled: false }, webAssetsDir);

    expect(existsSync(join(webAssetsDir, "splash"))).toBe(false);
  });

  it("copies the developer-authored splash folder into the web assets dir when enabled", () => {
    setup();
    mkdirSync(join(projectDir, "splash"), { recursive: true });
    writeFileSync(join(projectDir, "splash/index.html"), '<html><link rel="stylesheet" href="./styles.css"></html>');
    writeFileSync(join(projectDir, "splash/styles.css"), "body { margin: 0; }");

    generateSplash(projectDir, resolved(), webAssetsDir);

    const destDir = join(webAssetsDir, "splash");
    expect(existsSync(join(destDir, "index.html"))).toBe(true);
    expect(existsSync(join(destDir, "styles.css"))).toBe(true);
    expect(readFileSync(join(destDir, "styles.css"), "utf-8")).toBe("body { margin: 0; }");
  });

  it("removes stale files from a previous copy before copying again", () => {
    setup();
    mkdirSync(join(projectDir, "splash"), { recursive: true });
    writeFileSync(join(projectDir, "splash/index.html"), "<html></html>");
    mkdirSync(join(webAssetsDir, "splash"), { recursive: true });
    writeFileSync(join(webAssetsDir, "splash/stale.txt"), "leftover");

    generateSplash(projectDir, resolved(), webAssetsDir);

    expect(existsSync(join(webAssetsDir, "splash/stale.txt"))).toBe(false);
    expect(existsSync(join(webAssetsDir, "splash/index.html"))).toBe(true);
  });

  it("throws a clear error when the configured splash source folder doesn't exist", () => {
    setup();

    expect(() => generateSplash(projectDir, resolved({ source: "missing" }), webAssetsDir)).toThrow(/not found/);
  });

  it("throws a clear error when the splash folder has no index.html", () => {
    setup();
    mkdirSync(join(projectDir, "splash"), { recursive: true });
    writeFileSync(join(projectDir, "splash/styles.css"), "body {}");

    expect(() => generateSplash(projectDir, resolved(), webAssetsDir)).toThrow(/index\.html/);
  });

  it("warns, but still copies, when index.html references a file missing from the folder", () => {
    setup();
    mkdirSync(join(projectDir, "splash"), { recursive: true });
    writeFileSync(join(projectDir, "splash/index.html"), '<html><img src="./logo.png"></html>');
    const stderr = captureStderr();

    generateSplash(projectDir, resolved(), webAssetsDir);
    stderr.restore();

    expect(existsSync(join(webAssetsDir, "splash/index.html"))).toBe(true);
    expect(stderr.text()).toContain("[WARN]");
    expect(stderr.text()).toContain("logo.png");
  });

  it("does not warn about remote or anchor references", () => {
    setup();
    mkdirSync(join(projectDir, "splash"), { recursive: true });
    writeFileSync(
      join(projectDir, "splash/index.html"),
      '<html><a href="#top"></a><script src="https://example.com/a.js"></script></html>',
    );
    const stderr = captureStderr();

    generateSplash(projectDir, resolved(), webAssetsDir);
    stderr.restore();

    expect(stderr.text()).toBe("");
  });
});
