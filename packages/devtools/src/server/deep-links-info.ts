import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeepLinkEnvironmentInfo } from "../shared/events.js";

/** The deep link fields of `wefter.config.json` (top level or in an environment). */
interface DeepLinksShape {
  schemes?: string[];
  domains?: string[];
  paths?: string[];
}

/** The fields of `wefter.config.json` this module reads. */
interface WefterConfigShape {
  deepLinks?: DeepLinksShape;
  environments?: Record<string, { appId?: string; deepLinks?: DeepLinksShape }>;
}

/**
 * Each environment's deep links from the project's `wefter.config.json`, resolved the way `wefter sync`
 * does: a field set in the environment replaces the top-level one. `*` in `paths` means every path and is
 * reported as an empty list. A missing or unreadable config gives an empty list.
 */
export function collectDeepLinkInfo(projectRoot: string): DeepLinkEnvironmentInfo[] {
  let config: WefterConfigShape;
  try {
    config = JSON.parse(readFileSync(join(projectRoot, "wefter.config.json"), "utf-8")) as WefterConfigShape;
  } catch {
    return [];
  }

  const shared = config.deepLinks ?? {};
  return Object.entries(config.environments ?? {}).map(([name, environment]) => {
    const own = environment.deepLinks ?? {};
    const paths = own.paths ?? shared.paths ?? [];
    return {
      name,
      appId: environment.appId ?? "",
      schemes: own.schemes ?? shared.schemes ?? [],
      domains: own.domains ?? shared.domains ?? [],
      paths: paths.includes("*") ? [] : paths,
    };
  });
}
