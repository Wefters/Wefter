import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function shellTemplatePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../shells/android-template");
}

export function iosShellTemplatePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../../shells/ios-template");
}
