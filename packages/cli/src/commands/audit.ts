import { auditPluginPermissions, type DiscoveredPlugin } from "@wefter/registry-codegen";
import { loadWefterConfig, pluginsDirPath } from "../config/project-paths.js";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../plugins/registry.js";
import { checkLockDrift } from "../plugins/lockfile.js";

export interface AuditPluginInfo {
  name: string;
  permissions: string[];
  gradleDependency?: string;
}

export interface AuditResult {
  plugins: AuditPluginInfo[];
  unresolvedRegisteredPlugins: string[];
  permissionViolations: string[];
  lockDrift: string[];
}

function describePlugin(plugin: DiscoveredPlugin): AuditPluginInfo {
  return {
    name: plugin.manifest.name,
    permissions: plugin.manifest.permissions?.android ?? [],
    gradleDependency: plugin.manifest.nativeDependencies?.android?.gradle,
  };
}

export async function audit(projectDir: string): Promise<AuditResult> {
  const config = loadWefterConfig(projectDir);
  const pluginsDir = pluginsDirPath(projectDir, config);

  const plugins = resolveRegisteredPlugins(pluginsDir, config.plugins);
  const unresolved = unresolvedRegisteredPlugins(pluginsDir, config.plugins);
  const permissionViolations = auditPluginPermissions(plugins);
  const lockDrift = checkLockDrift(projectDir, plugins);

  return {
    plugins: plugins.map(describePlugin),
    unresolvedRegisteredPlugins: unresolved,
    permissionViolations,
    lockDrift,
  };
}
