import { existsSync, readFileSync } from "node:fs";
import type { DiscoveredPlugin } from "@wefterjs/registry-codegen";
import { iosInfoPlistPath } from "../config/project-paths.js";

export interface PlistPermissionCheckResult {
  passed: boolean;
  issues: string[];
}

export function checkInfoPlistPermissionKeys(
  projectDir: string,
  declaredPlugins: DiscoveredPlugin[],
): PlistPermissionCheckResult {
  const infoPlistPath = iosInfoPlistPath(projectDir);

  if (!existsSync(infoPlistPath)) {
    return {
      passed: false,
      issues: [`Info.plist not found at ${infoPlistPath} — run \`wefter sync\` first`],
    };
  }

  const infoPlistContents = readFileSync(infoPlistPath, "utf-8");
  const issues: string[] = [];

  for (const plugin of declaredPlugins) {
    const iosPermissions = plugin.manifest.permissions?.ios ?? {};
    for (const key of Object.keys(iosPermissions)) {
      if (!infoPlistContents.includes(`<key>${key}</key>`)) {
        issues.push(
          `Missing "${key}" in Info.plist, required by plugin "${plugin.manifest.name}" — calling this ` +
            `permission's API will CRASH the app immediately, not deny gracefully. Run \`wefter sync\` to ` +
            `regenerate Info.plist correctly, or check for a hand-edit if this project has been ejected.`,
        );
      }
    }
  }

  return { passed: issues.length === 0, issues };
}
