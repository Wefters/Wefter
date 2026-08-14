import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { generateAndroidIcons } from "../src/native/icon-generator.js";

let projectDir: string;
let resDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe("generateAndroidIcons", () => {
  it("generates a correctly-sized PNG for every mipmap density", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-icon-"));
    resDir = join(projectDir, "res");
    const sourcePath = join(projectDir, "icon.png");
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ff0000" } })
      .png()
      .toFile(sourcePath);

    await generateAndroidIcons(projectDir, "icon.png", resDir);

    const expected: Record<string, number> = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    for (const [density, size] of Object.entries(expected)) {
      const outPath = join(resDir, `mipmap-${density}`, "ic_launcher.png");
      const metadata = await sharp(outPath).metadata();
      expect(metadata.width).toBe(size);
      expect(metadata.height).toBe(size);
    }
  });

  it("generates an adaptive icon foreground layer and anydpi-v26 XML for every density", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-icon-"));
    resDir = join(projectDir, "res");
    const sourcePath = join(projectDir, "icon.png");
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ff0000" } })
      .png()
      .toFile(sourcePath);

    await generateAndroidIcons(projectDir, "icon.png", resDir);

    const expectedForeground: Record<string, number> = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
    for (const [density, size] of Object.entries(expectedForeground)) {
      const outPath = join(resDir, `mipmap-${density}`, "ic_launcher_foreground.png");
      const metadata = await sharp(outPath).metadata();
      expect(metadata.width).toBe(size);
      expect(metadata.height).toBe(size);
    }

    for (const filename of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
      const xml = readFileSync(join(resDir, "mipmap-anydpi-v26", filename), "utf-8");
      expect(xml).toContain("<adaptive-icon");
      expect(xml).toContain('android:drawable="@mipmap/ic_launcher_foreground"');
      expect(xml).toContain('android:drawable="@color/ic_launcher_background"');
    }

    const colorXml = readFileSync(join(resDir, "values", "ic_launcher_background.xml"), "utf-8");
    expect(colorXml).toContain('<color name="ic_launcher_background">#ff0000</color>');
  });

  it("falls back to white adaptive icon background when the source corner is transparent", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-icon-"));
    resDir = join(projectDir, "res");
    const sourcePath = join(projectDir, "icon.png");
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toFile(sourcePath);

    await generateAndroidIcons(projectDir, "icon.png", resDir);

    const colorXml = readFileSync(join(resDir, "values", "ic_launcher_background.xml"), "utf-8");
    expect(colorXml).toContain('<color name="ic_launcher_background">#FFFFFF</color>');
  });

  it("rejects a source image smaller than 1024x1024", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-icon-"));
    resDir = join(projectDir, "res");
    const sourcePath = join(projectDir, "icon.png");
    await sharp({ create: { width: 512, height: 512, channels: 4, background: "#ff0000" } })
      .png()
      .toFile(sourcePath);

    await expect(generateAndroidIcons(projectDir, "icon.png", resDir)).rejects.toThrow(/1024x1024/);
  });
});
