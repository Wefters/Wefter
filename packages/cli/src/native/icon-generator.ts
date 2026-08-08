import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const DENSITIES: Record<string, number> = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

export async function generateAndroidIcons(projectDir: string, iconSourcePath: string, resDir: string): Promise<void> {
  const source = resolve(projectDir, iconSourcePath);

  for (const [density, size] of Object.entries(DENSITIES)) {
    const dir = join(resDir, `mipmap-${density}`);
    mkdirSync(dir, { recursive: true });
    await sharp(source).resize(size, size).png().toFile(join(dir, "ic_launcher.png"));
  }
}
