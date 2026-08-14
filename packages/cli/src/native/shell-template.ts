import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveTemplateDir(templateName: "android-template" | "ios-template"): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
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

  return join(currentDir, `../../../shells/${templateName}`);
}

export function shellTemplatePath(): string {
  return resolveTemplateDir("android-template");
}

export function iosShellTemplatePath(): string {
  return resolveTemplateDir("ios-template");
}
