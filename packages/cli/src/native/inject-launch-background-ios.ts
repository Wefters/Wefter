import { readFileSync, writeFileSync } from "node:fs";

function hexComponentToUnitFloat(hex: string, start: number): string {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return String(Math.round(value * 10000) / 10000);
}

export function injectLaunchBackgroundIos(storyboardPath: string, hexColor: string): void {
  const current = readFileSync(storyboardPath, "utf-8");
  const pattern = /<color key="backgroundColor"[^>]*\/>/;
  if (!pattern.test(current)) {
    throw new Error(`No backgroundColor <color> element found in ${storyboardPath}`);
  }

  const red = hexComponentToUnitFloat(hexColor, 1);
  const green = hexComponentToUnitFloat(hexColor, 3);
  const blue = hexComponentToUnitFloat(hexColor, 5);
  const replacement = `<color key="backgroundColor" red="${red}" green="${green}" blue="${blue}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>`;

  writeFileSync(storyboardPath, current.replace(pattern, replacement));
}
