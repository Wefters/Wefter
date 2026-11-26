/**
 * Resolves the `deepLinks` settings of `wefter.config.json` for one environment, and translates its path
 * patterns into each platform's terms.
 */

import type { WefterConfig } from "./wefter-config-schema.js";

/** The deep link settings that apply to one environment. An empty `paths` means every path. */
export interface ResolvedDeepLinks {
  schemes: string[];
  domains: string[];
  paths: string[];
}

/**
 * The deep link settings of `env`: each field the environment sets replaces the top-level one, and the
 * rest come from the top level. An environment missing from the config gets the top-level settings.
 */
export function resolveDeepLinks(config: WefterConfig, env: string): ResolvedDeepLinks {
  const shared = config.deepLinks ?? {};
  const own = config.environments[env]?.deepLinks ?? {};
  const paths = own.paths ?? shared.paths ?? [];
  return {
    schemes: own.schemes ?? shared.schemes ?? [],
    domains: own.domains ?? shared.domains ?? [],
    paths: paths.includes("*") ? [] : paths,
  };
}

/** Whether any environment registers a verified domain. */
export function usesVerifiedDomains(config: WefterConfig): boolean {
  return Object.keys(config.environments).some((env) => resolveDeepLinks(config, env).domains.length > 0);
}

/** The `<data>` attribute that matches one path pattern on Android: `pathPrefix` for `/x/*`, else `path`. */
export function androidPathAttribute(path: string): { name: "path" | "pathPrefix"; value: string } {
  return path.endsWith("*") ? { name: "pathPrefix", value: path.slice(0, -1) } : { name: "path", value: path };
}

/**
 * The `components` of an `apple-app-site-association` entry for these paths. Apple's patterns use the same
 * `*` wildcard, so each path is used as it is.
 */
export function appleComponents(paths: string[]): { "/": string }[] {
  return paths.length === 0 ? [{ "/": "*" }] : paths.map((path) => ({ "/": path }));
}
