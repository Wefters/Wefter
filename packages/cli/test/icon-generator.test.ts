import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
    await sharp({ create: { width: 512, height: 512, channels: 4, background: "#ff0000" } }).png().toFile(sourcePath);

    await generateAndroidIcons(projectDir, "icon.png", resDir);

    const expected: Record<string, number> = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    for (const [density, size] of Object.entries(expected)) {
      const outPath = join(resDir, `mipmap-${density}`, "ic_launcher.png");
      const metadata = await sharp(outPath).metadata();
      expect(metadata.width).toBe(size);
      expect(metadata.height).toBe(size);
    }
  });
});
