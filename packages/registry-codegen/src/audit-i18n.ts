import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Checks a plugin's own text (`i18n/<language>.json`): English must be there, since it is what users see
 * when their language is missing, and every key must start with the plugin's name, so plugins never
 * replace each other's text or the shell's.
 *
 * @returns One warning per problem; empty when the plugin has no `i18n/` folder or passes.
 */
export function i18nWarnings(pluginName: string, pluginDir: string): string[] {
  const dir = join(pluginDir, "i18n");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const warnings: string[] = [];
  if (!files.includes("en.json")) warnings.push(`Plugin "${pluginName}" has i18n/ but no i18n/en.json`);
  for (const file of files) {
    let texts: unknown;
    try {
      texts = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    } catch (e) {
      warnings.push(`Plugin "${pluginName}": i18n/${file} is not valid JSON (${(e as Error).message})`);
      continue;
    }
    if (!texts || typeof texts !== "object" || Array.isArray(texts)) {
      warnings.push(`Plugin "${pluginName}": i18n/${file} must be an object of keys to text`);
      continue;
    }
    for (const [key, value] of Object.entries(texts as Record<string, unknown>)) {
      if (!key.startsWith(`${pluginName}.`)) {
        warnings.push(`Plugin "${pluginName}": i18n/${file} key "${key}" must start with "${pluginName}."`);
      }
      if (typeof value !== "string") warnings.push(`Plugin "${pluginName}": i18n/${file} "${key}" is not text`);
    }
  }
  return warnings;
}
