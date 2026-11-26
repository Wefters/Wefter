import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** All Swift files in a plugin's `ios/` folder, joined into one string. Empty when there is none. */
export function readPluginSwiftSource(packageDir: string): string {
  const iosDir = join(packageDir, "ios");
  if (!existsSync(iosDir)) return "";

  return readdirSync(iosDir)
    .filter((f) => f.endsWith(".swift"))
    .map((f) => readFileSync(join(iosDir, f), "utf-8"))
    .join("\n");
}
