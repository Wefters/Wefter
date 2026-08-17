import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginInfo } from "../shared/events.js";

interface WefterConfigShape {
  plugins?: string[];
  pluginsDir?: string;
}

interface PluginManifestShape {
  methods?: string[];
  hooks?: string[];
  events?: string[];
  permissions?: { android?: string[]; ios?: Record<string, string> | string[] };
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

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
