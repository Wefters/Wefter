import { validatePluginDirectory, type PluginValidationResult } from "@wefterjs/registry-codegen";

export function pluginValidate(pluginDir: string): PluginValidationResult {
  return validatePluginDirectory(pluginDir);
}
