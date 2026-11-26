import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** All Kotlin files in a plugin's `android/` folder, joined into one string. Empty when there is none. */
export function readPluginKotlinSource(packageDir: string): string {
  const androidDir = join(packageDir, "android");
  if (!existsSync(androidDir)) return "";

  return readdirSync(androidDir)
    .filter((f) => f.endsWith(".kt"))
    .map((f) => readFileSync(join(androidDir, f), "utf-8"))
    .join("\n");
}
