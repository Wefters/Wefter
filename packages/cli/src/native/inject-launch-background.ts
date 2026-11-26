import { readFileSync, writeFileSync } from "node:fs";

/**
 * Sets the `splashBackground` colour resource shown while the Android app starts.
 *
 * @throws {Error} When the colour resource is missing.
 */
export function injectLaunchBackgroundAndroid(colorsXmlPath: string, hexColor: string): void {
  const current = readFileSync(colorsXmlPath, "utf-8");
  const pattern = /(<color name="splashBackground">)[^<]*(<\/color>)/;
  if (!pattern.test(current)) {
    throw new Error(`No splashBackground <color> entry found in ${colorsXmlPath}`);
  }
  writeFileSync(colorsXmlPath, current.replace(pattern, `$1${hexColor}$2`));
}
