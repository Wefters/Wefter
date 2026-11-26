/**
 * `wefter audit`: reports what the project's plugins add to the native app and anything that needs
 * attention, without changing files.
 */

import {
  auditPluginPermissions,
  computeGradleMerge,
  extractRequiredPluginConfigKeys,
  type DiscoveredPlugin,
} from "@wefterjs/registry-codegen";
import { loadWefterConfig, pluginsDirPath } from "../config/project-paths.js";
import { resolveRegisteredPlugins, unresolvedRegisteredPlugins } from "../plugins/registry.js";
import { checkLockDrift } from "../plugins/lockfile.js";

/** An Android component a plugin adds. */
export interface AuditComponentInfo {
  type: string;
  name: string;
  exported: boolean;
}

/** What one plugin adds to the Android app. */
export interface AuditPluginInfo {
  name: string;
  permissions: string[];
  gradleDependencies: string[];
  components: AuditComponentInfo[];
}

/**
 * The audit report.
 *
 * - `permissionViolations`: sensitive APIs used without the matching permission.
 * - `lockDrift`: plugins whose version changed since the last sync.
 * - `gradleConflicts`: dependencies requested at different major versions.
 * - `exportedComponentWarnings`: components other apps can start.
 * - `requiredConfigKeys`: `pluginConfig` keys that plugins need but are not set.
 */
export interface AuditResult {
  plugins: AuditPluginInfo[];
  unresolvedRegisteredPlugins: string[];
  permissionViolations: string[];
  lockDrift: string[];
  gradleConflicts: string[];
  exportedComponentWarnings: string[];
  requiredConfigKeys: string[];
}

/** Summarises a plugin's permissions, dependencies and components. */
function describePlugin(plugin: DiscoveredPlugin): AuditPluginInfo {
  return {
    name: plugin.manifest.name,
    permissions: plugin.manifest.permissions?.android ?? [],
    gradleDependencies: plugin.manifest.nativeDependencies?.android?.gradle ?? [],
    components: (plugin.manifest.android?.manifestEntries ?? []).map((entry) => ({
      type: entry.type,
      name: entry.name,
      exported: entry.exported,
    })),
  };
}

/** Audits the plugins declared in `wefter.config.json`. */
export async function audit(projectDir: string): Promise<AuditResult> {
  const config = loadWefterConfig(projectDir);
  const pluginsDir = pluginsDirPath(projectDir, config);

  const plugins = resolveRegisteredPlugins(pluginsDir, config.plugins);
  const unresolved = unresolvedRegisteredPlugins(pluginsDir, config.plugins);
  const permissionViolations = auditPluginPermissions(plugins);
  const lockDrift = checkLockDrift(projectDir, plugins);
  const { conflicts: gradleConflicts } = computeGradleMerge(plugins);

  const exportedComponentWarnings: string[] = [];
  const requiredConfigKeys = new Set<string>();
  for (const plugin of plugins) {
    for (const entry of plugin.manifest.android?.manifestEntries ?? []) {
      if (entry.exported) {
        exportedComponentWarnings.push(
          `${plugin.manifest.name}: declares an exported ${entry.type} (${entry.name}) — reachable from outside the app.`,
        );
      }
    }
    for (const key of extractRequiredPluginConfigKeys(plugin.manifest)) {
      if (config.pluginConfig[key] === undefined) requiredConfigKeys.add(key);
    }
  }

  return {
    plugins: plugins.map(describePlugin),
    unresolvedRegisteredPlugins: unresolved,
    permissionViolations,
    lockDrift,
    gradleConflicts,
    exportedComponentWarnings,
    requiredConfigKeys: [...requiredConfigKeys],
  };
}
