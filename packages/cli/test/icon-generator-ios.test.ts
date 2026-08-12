import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { generateIosIcons } from "../src/native/icon-generator-ios.js";

let projectDir: string;
let appIconSetDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe("generateIosIcons", () => {
  it("generates a single 1024x1024 PNG (the modern single-size App Store format)", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-ios-icon-"));
    appIconSetDir = join(projectDir, "AppIcon.appiconset");
    const sourcePath = join(projectDir, "icon.png");
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ff0000" } }).png().toFile(sourcePath);

    await generateIosIcons(projectDir, "icon.png", appIconSetDir);

    const outPath = join(appIconSetDir, "icon-1024.png");
    expect(existsSync(outPath)).toBe(true);
    const metadata = await sharp(outPath).metadata();
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(1024);
  });

  it("flattens a transparent source onto white — App Store review rejects an alpha channel", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-ios-icon-"));
    appIconSetDir = join(projectDir, "AppIcon.appiconset");
    const sourcePath = join(projectDir, "icon.png");
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } })
      .png()
      .toFile(sourcePath);

    await generateIosIcons(projectDir, "icon.png", appIconSetDir);

    const metadata = await sharp(join(appIconSetDir, "icon-1024.png")).metadata();
    expect(metadata.hasAlpha).toBe(false);
  });

  it("writes a Contents.json declaring the single universal ios 1024x1024 slot", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-ios-icon-"));
    appIconSetDir = join(projectDir, "AppIcon.appiconset");
    const sourcePath = join(projectDir, "icon.png");
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ff0000" } }).png().toFile(sourcePath);

    await generateIosIcons(projectDir, "icon.png", appIconSetDir);

    const contents = JSON.parse(readFileSync(join(appIconSetDir, "Contents.json"), "utf-8"));
    expect(contents.images).toHaveLength(1);
    expect(contents.images[0]).toMatchObject({ filename: "icon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" });
  });

  it("rejects a source image smaller than 1024x1024", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-ios-icon-"));
    appIconSetDir = join(projectDir, "AppIcon.appiconset");
    const sourcePath = join(projectDir, "icon.png");
    await sharp({ create: { width: 512, height: 512, channels: 4, background: "#ff0000" } }).png().toFile(sourcePath);

    await expect(generateIosIcons(projectDir, "icon.png", appIconSetDir)).rejects.toThrow(/1024x1024/);
  });
});
