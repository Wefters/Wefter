import { validatePluginDirectory, type PluginValidationResult } from "@wefter/registry-codegen";

export function pluginValidate(pluginDir: string): PluginValidationResult {
  return validatePluginDirectory(pluginDir);
}
