/**
 * `wefter eject`: hands the native projects over to the developer. After ejecting, `android/` and `ios/`
 * live in the project root and `wefter sync` updates them in place instead of regenerating them.
 */

import { cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sync } from "./sync.js";
import { androidProjectRootDir, ejectMarkerPath, iosProjectRootDir, isEjected } from "../config/project-paths.js";

/** Where each platform's generated project lives, and the folder it is copied to. */
const PLATFORMS: { rootDir: (projectDir: string) => string; destName: string }[] = [
  { rootDir: androidProjectRootDir, destName: "android" },
  { rootDir: iosProjectRootDir, destName: "ios" },
];

/**
 * Syncs once more, copies the native projects into the project root and marks the project as ejected.
 *
 * @returns The folders that were created.
 * @throws {Error} When the project is already ejected.
 */
export async function eject(projectDir: string): Promise<string[]> {
  if (isEjected(projectDir)) {
    throw new Error("Already ejected — android/ and ios/ are already yours.");
  }

  await sync(projectDir);

  const dests: string[] = [];
  for (const platform of PLATFORMS) {
    const source = platform.rootDir(projectDir);
    if (!existsSync(source)) continue;
    const dest = join(projectDir, platform.destName);
    cpSync(source, dest, { recursive: true });
    dests.push(dest);
  }

  writeFileSync(ejectMarkerPath(projectDir), "true\n");

  return dests;
}
