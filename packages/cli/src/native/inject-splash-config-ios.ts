import { readFileSync, writeFileSync } from "node:fs";

const START = "// WEFTER-SPLASH-CONFIG-START";
const END = "// WEFTER-SPLASH-CONFIG-END";

/** Splash screen settings from `wefter.config.json`. */
export interface IosSplashConfigValues {
  enabled: boolean;
  minDuration: number;
  maxDuration: number;
  dismissOn: "ready" | "timer";
  transition: "fade" | "none";
}

/**
 * Writes the splash settings as constants into `BuildConfig.swift`, between the `WEFTER-SPLASH-CONFIG`
 * markers.
 *
 * @throws {Error} When the markers are missing.
 */
export function injectSplashConfigIos(buildConfigPath: string, values: IosSplashConfigValues): void {
  const current = readFileSync(buildConfigPath, "utf-8");
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}`);

  if (!pattern.test(current)) {
    throw new Error(`No ${START} marker found in ${buildConfigPath}`);
  }

  const lines = [
    `    static let splashEnabled = ${values.enabled}`,
    `    static let splashMinDurationMs: Double = ${values.minDuration}`,
    `    static let splashMaxDurationMs: Double = ${values.maxDuration}`,
    `    static let splashWaitForReady = ${values.dismissOn === "ready"}`,
    `    static let splashFadeTransition = ${values.transition === "fade"}`,
  ].join("\n");

  const block = `${START}\n${lines}\n    ${END}`;
  writeFileSync(buildConfigPath, current.replace(pattern, block));
}
