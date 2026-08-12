import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { iconGenerate } from "../src/commands/icon.js";

let projectDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe("iconGenerate", () => {
  it("generates icons into the project's woven android res dir", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-icon-cmd-"));
    const sourcePath = join(projectDir, "icon.png");
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#00ff00" } }).png().toFile(sourcePath);

    await iconGenerate(projectDir, "icon.png");

    expect(existsSync(join(projectDir, ".wefter/native/android/app/src/main/res/mipmap-mdpi/ic_launcher.png"))).toBe(true);
  });

  it("throws a clear error when the source image doesn't exist", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-icon-cmd-"));

    await expect(iconGenerate(projectDir, "missing.png")).rejects.toThrow(/not found/);
  });
});
