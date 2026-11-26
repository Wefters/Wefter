import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginInfo } from "../shared/events.js";

/** The fields of `wefter.config.json` this module reads. */
interface WefterConfigShape {
  plugins?: string[];
  pluginsDir?: string;
}

/** The fields of `plugin.json` this module reads. */
interface PluginManifestShape {
  methods?: string[];
  hooks?: string[];
  events?: string[];
  permissions?: { android?: string[]; ios?: Record<string, string> | string[] };
}

/** Parses a JSON file, or returns `undefined` when it is missing or invalid. */
function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * Describes every plugin listed in the project's `wefter.config.json`: its methods, hooks, events,
 * permissions and which platforms it has native source for. Unreadable manifests produce empty lists
 * rather than errors.
 */
export function collectPluginInfo(projectRoot: string): PluginInfo[] {
  const config = readJson<WefterConfigShape>(join(projectRoot, "wefter.config.json"));
  const pluginIds = config?.plugins ?? [];
  const pluginsDir = join(projectRoot, config?.pluginsDir ?? "node_modules");

  return pluginIds.map((id): PluginInfo => {
    const packageDir = join(pluginsDir, id);
    const manifest = readJson<PluginManifestShape>(join(packageDir, "plugin.json"));
    const iosPermissionsRaw = manifest?.permissions?.ios;
    const iosPermissions = Array.isArray(iosPermissionsRaw) ? iosPermissionsRaw : Object.keys(iosPermissionsRaw ?? {});

    return {
      id,
      methods: manifest?.methods ?? [],
      hooks: manifest?.hooks ?? [],
      events: manifest?.events ?? [],
      androidPermissions: manifest?.permissions?.android ?? [],
      iosPermissions,
      hasAndroidSource: existsSync(join(packageDir, "android")),
      hasIosSource: existsSync(join(packageDir, "ios")),
    };
  });
}
