import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { assertIconSourceSize } from "./icon-source.js";

const DENSITIES: Record<string, number> = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const ADAPTIVE_FOREGROUND_SIZES: Record<string, number> = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};

async function sampleCornerColor(source: string): Promise<string> {
  const pixel = await sharp(source).extract({ left: 0, top: 0, width: 1, height: 1 }).ensureAlpha().raw().toBuffer();
  const [r, g, b, a] = pixel;
  if (a < 255) return "#FFFFFF";
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const ADAPTIVE_ICON_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;

function backgroundColorXml(backgroundColor: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${backgroundColor}</color>
</resources>
`;
}

export async function generateAndroidIcons(projectDir: string, iconSourcePath: string, resDir: string): Promise<void> {
  const source = resolve(projectDir, iconSourcePath);
  await assertIconSourceSize(source);

  for (const [density, size] of Object.entries(DENSITIES)) {
    const dir = join(resDir, `mipmap-${density}`);
    mkdirSync(dir, { recursive: true });
    await sharp(source).resize(size, size).png().toFile(join(dir, "ic_launcher.png"));
  }

  for (const [density, size] of Object.entries(ADAPTIVE_FOREGROUND_SIZES)) {
    const dir = join(resDir, `mipmap-${density}`);
    mkdirSync(dir, { recursive: true });
    await sharp(source).resize(size, size).png().toFile(join(dir, "ic_launcher_foreground.png"));
  }

  const anydpiDir = join(resDir, "mipmap-anydpi-v26");
  mkdirSync(anydpiDir, { recursive: true });
  writeFileSync(join(anydpiDir, "ic_launcher.xml"), ADAPTIVE_ICON_XML);
  writeFileSync(join(anydpiDir, "ic_launcher_round.xml"), ADAPTIVE_ICON_XML);

  const valuesDir = join(resDir, "values");
  mkdirSync(valuesDir, { recursive: true });
  writeFileSync(join(valuesDir, "ic_launcher_background.xml"), backgroundColorXml(await sampleCornerColor(source)));
}
