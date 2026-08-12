import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_LAUNCH_BACKGROUND,
  detectSplashBackgroundColor,
  resolveLaunchBackground,
} from "../src/native/resolve-launch-background.js";
import { WefterConfigSchema, type WefterConfig } from "../src/config/wefter-config-schema.js";

let projectDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

function configWith(overrides: Record<string, unknown>): WefterConfig {
  return WefterConfigSchema.parse({
    environments: { development: { appId: "com.example.app", appName: "Example" } },
    ...overrides,
  });
}

describe("detectSplashBackgroundColor", () => {
  it("returns null when index.html doesn't exist", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    expect(detectSplashBackgroundColor(projectDir)).toBeNull();
  });

  it("returns null when neither inline nor linked CSS declares a body background", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    writeFileSync(join(projectDir, "index.html"), "<html><body>hi</body></html>");
    expect(detectSplashBackgroundColor(projectDir)).toBeNull();
  });

  it("detects a body background-color from an inline <style> block", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    writeFileSync(
      join(projectDir, "index.html"),
      "<html><head><style>body { background-color: #0F766E; }</style></head><body></body></html>",
    );
    expect(detectSplashBackgroundColor(projectDir)).toBe("#0F766E");
  });

  it("detects a body background from a linked local stylesheet", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    writeFileSync(
      join(projectDir, "index.html"),
      '<html><head><link rel="stylesheet" href="./styles.css"></head><body></body></html>',
    );
    writeFileSync(join(projectDir, "styles.css"), "body {\n  margin: 0;\n  background: #0F766E;\n}\n");
    expect(detectSplashBackgroundColor(projectDir)).toBe("#0F766E");
  });

  it("falls back to :root or html when there's no body rule", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    writeFileSync(
      join(projectDir, "index.html"),
      "<html><head><style>:root { background: #123456; }</style></head><body></body></html>",
    );
    expect(detectSplashBackgroundColor(projectDir)).toBe("#123456");
  });

  it("expands a 3-digit hex shorthand to 6 digits", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    writeFileSync(
      join(projectDir, "index.html"),
      "<html><head><style>body { background: #0Fe; }</style></head><body></body></html>",
    );
    expect(detectSplashBackgroundColor(projectDir)).toBe("#00FFee");
  });

  it("ignores a remote stylesheet link", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    writeFileSync(
      join(projectDir, "index.html"),
      '<html><head><link rel="stylesheet" href="https://cdn.example.com/styles.css"></head><body></body></html>',
    );
    expect(detectSplashBackgroundColor(projectDir)).toBeNull();
  });
});

describe("resolveLaunchBackground", () => {
  it("returns the default white when nothing is configured", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    const config = configWith({});
    expect(resolveLaunchBackground(config, projectDir)).toBe(DEFAULT_LAUNCH_BACKGROUND);
  });

  it("returns the explicit launchBackground when set, even with a splash configured", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    mkdirSync(join(projectDir, "splash"));
    writeFileSync(
      join(projectDir, "splash/index.html"),
      "<html><head><style>body { background: #0F766E; }</style></head><body></body></html>",
    );
    const config = configWith({ launchBackground: "#ABCDEF", splash: { source: "./splash" } });
    expect(resolveLaunchBackground(config, projectDir)).toBe("#ABCDEF");
  });

  it("falls back to the splash source's detected background when launchBackground isn't set", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    mkdirSync(join(projectDir, "splash"));
    writeFileSync(
      join(projectDir, "splash/index.html"),
      "<html><head><style>body { background: #0F766E; }</style></head><body></body></html>",
    );
    const config = configWith({ splash: { source: "./splash" } });
    expect(resolveLaunchBackground(config, projectDir)).toBe("#0F766E");
  });

  it("falls back to white when splash is configured but its background isn't detectable", () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-launchbg-"));
    mkdirSync(join(projectDir, "splash"));
    writeFileSync(join(projectDir, "splash/index.html"), "<html><body>hi</body></html>");
    const config = configWith({ splash: { source: "./splash" } });
    expect(resolveLaunchBackground(config, projectDir)).toBe(DEFAULT_LAUNCH_BACKGROUND);
  });
});

describe("launchBackground schema validation", () => {
  it("accepts a well-formed 6-digit hex color", () => {
    expect(() => configWith({ launchBackground: "#14161C" })).not.toThrow();
  });

  it("rejects a 3-digit shorthand", () => {
    expect(() => configWith({ launchBackground: "#FFF" })).toThrow();
  });

  it("rejects a non-hex value", () => {
    expect(() => configWith({ launchBackground: "blue" })).toThrow();
  });
});
