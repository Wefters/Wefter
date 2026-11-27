/**
 * Values in `wefter.config.json` that can come from the environment: a value written as `${VAR}` (or with
 * `${VAR}` inside it) is filled in from that variable, so secrets can stay in `.env` or a CI secret store
 * while the config holds everything else.
 */

/** `${NAME}`, where NAME is a shell-style variable name. */
const ENV_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** A config value with its `${VAR}` references filled in, and the variables that were not set. */
export interface ExpandedValue {
  value: string;
  missing: string[];
}

/**
 * Fills in every `${VAR}` in `value` from `env`. A variable that is not set (or is empty) becomes an empty
 * string and is listed in `missing`.
 */
export function expandEnvReferences(value: string, env: NodeJS.ProcessEnv = process.env): ExpandedValue {
  const missing: string[] = [];
  const expanded = value.replace(ENV_REFERENCE_PATTERN, (_match, name: string) => {
    const resolved = env[name];
    if (resolved === undefined || resolved === "") {
      missing.push(name);
      return "";
    }
    return resolved;
  });
  return { value: expanded, missing };
}

/** Whether `value` reads anything from the environment (`${VAR}`), rather than being written out in full. */
export function referencesEnvironment(value: string): boolean {
  return new RegExp(ENV_REFERENCE_PATTERN.source).test(value);
}

/**
 * A setting that can be given by an environment variable or in the config: the variable wins, then the
 * config value with its `${VAR}` references filled in.
 */
export interface ResolvedSetting {
  /** The value, or `undefined` when neither the variable nor the config gives one. */
  value: string | undefined;
  /** Variables the config value referenced that are not set. */
  missing: string[];
}

/** Resolves one setting from `envName` (if set) or `configValue`. See {@link ResolvedSetting}. */
export function resolveSetting(
  envName: string,
  configValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSetting {
  const fromEnv = env[envName];
  if (fromEnv !== undefined && fromEnv !== "") return { value: fromEnv, missing: [] };
  if (configValue === undefined) return { value: undefined, missing: [] };
  const expanded = expandEnvReferences(configValue, env);
  return { value: expanded.missing.length > 0 ? undefined : expanded.value, missing: expanded.missing };
}
