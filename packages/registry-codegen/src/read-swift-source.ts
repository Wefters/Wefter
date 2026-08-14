import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function readPluginSwiftSource(packageDir: string): string {
  const iosDir = join(packageDir, "ios");
  if (!existsSync(iosDir)) return "";

  return readdirSync(iosDir)
    .filter((f) => f.endsWith(".swift"))
    .map((f) => readFileSync(join(iosDir, f), "utf-8"))
    .join("\n");
}
