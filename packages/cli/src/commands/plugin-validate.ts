import { validatePluginDirectory, type PluginValidationResult } from "@wefterjs/registry-codegen";

/** `wefter plugin validate`: checks that a folder is a valid Wefter plugin. */
export function pluginValidate(pluginDir: string): PluginValidationResult {
  return validatePluginDirectory(pluginDir);
}
