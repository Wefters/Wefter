import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function readPluginKotlinSource(packageDir: string): string {
  const androidDir = join(packageDir, "android");
  if (!existsSync(androidDir)) return "";

  return readdirSync(androidDir)
    .filter((f) => f.endsWith(".kt"))
    .map((f) => readFileSync(join(androidDir, f), "utf-8"))
    .join("\n");
}
