import { cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sync } from "./sync.js";
import { androidProjectRootDir, ejectMarkerPath, iosProjectRootDir, isEjected } from "../config/project-paths.js";

const PLATFORMS: { rootDir: (projectDir: string) => string; destName: string }[] = [
  { rootDir: androidProjectRootDir, destName: "android" },
  { rootDir: iosProjectRootDir, destName: "ios" },
];

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
