import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { assertIconSourceSize } from "./icon-source.js";

const APP_ICON_SIZE = 1024;

const APP_ICON_CONTENTS_JSON = `{
  "images" : [
    {
      "filename" : "icon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`;

export async function generateIosIcons(projectDir: string, iconSourcePath: string, appIconSetDir: string): Promise<void> {
  const source = resolve(projectDir, iconSourcePath);
  await assertIconSourceSize(source);

  mkdirSync(appIconSetDir, { recursive: true });
  
  
  await sharp(source)
    .resize(APP_ICON_SIZE, APP_ICON_SIZE)
    .flatten({ background: "#ffffff" })
    .png()
    .toFile(join(appIconSetDir, "icon-1024.png"));

  writeFileSync(join(appIconSetDir, "Contents.json"), APP_ICON_CONTENTS_JSON);
}
