import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Finds a native shell template. It is bundled next to the published CLI, and in the monorepo it lives in
 * `shells/`; the candidates cover both layouts and the compiled and source locations.
 */
function resolveTemplateDir(templateName: "android-template" | "ios-template" | "i18n"): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(currentDir, `shells/${templateName}`),
    join(currentDir, `../../../shells/${templateName}`),
    join(currentDir, `../../../../shells/${templateName}`),
    join(currentDir, `../../shells/${templateName}`),
    join(currentDir, `../shells/${templateName}`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return join(currentDir, `shells/${templateName}`);
}

/** The Android shell template. */
export function shellTemplatePath(): string {
  return resolveTemplateDir("android-template");
}

/** The iOS shell template. */
export function iosShellTemplatePath(): string {
  return resolveTemplateDir("ios-template");
}

/** The shells' own text, `i18n/<language>.json`, shared by both platforms. */
export function shellMessagesDir(): string {
  return resolveTemplateDir("i18n");
}
