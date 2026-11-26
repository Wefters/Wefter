import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateAndroidIcons } from "../native/icon-generator.js";
import { androidResDir } from "../config/project-paths.js";

/**
 * `wefter icon`: writes the Android launcher icons from a source image.
 *
 * @throws {Error} When the source image does not exist or is too small.
 */
export async function iconGenerate(projectDir: string, sourcePath: string): Promise<void> {
  if (!existsSync(resolve(projectDir, sourcePath))) {
    throw new Error(`Icon source not found: ${resolve(projectDir, sourcePath)}`);
  }
  await generateAndroidIcons(projectDir, sourcePath, androidResDir(projectDir));
}
