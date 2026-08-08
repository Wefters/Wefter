import type { DiscoveredPlugin } from './scan-plugins.js';
import { readPluginKotlinSource } from './read-kotlin-source.js';

const SENSITIVE_API_PATTERNS: Record<string, string> = {
  CameraX: 'android.permission.CAMERA',
  LocationManager: 'android.permission.ACCESS_FINE_LOCATION',
};

export function auditPluginPermissions(plugins: DiscoveredPlugin[]): string[] {
  const violations: string[] = [];

  for (const plugin of plugins) {
    const declared = plugin.manifest.permissions?.android ?? [];
    const source = readPluginKotlinSource(plugin.packageDir);

    for (const [pattern, permission] of Object.entries(SENSITIVE_API_PATTERNS)) {
      if (source.includes(pattern) && !declared.includes(permission)) {
        violations.push(
          `${plugin.manifest.name}: uses ${pattern} but does not declare ${permission} in plugin.json`,
        );
      }
    }
  }

  return violations;
}
