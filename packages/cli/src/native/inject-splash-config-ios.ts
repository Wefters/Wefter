import { readFileSync, writeFileSync } from "node:fs";

const START = "// WEFTER-SPLASH-CONFIG-START";
const END = "// WEFTER-SPLASH-CONFIG-END";

export interface IosSplashConfigValues {
  enabled: boolean;
  minDurationMs: number;
  fadeOutDurationMs: number;
}

export function injectSplashConfigIos(buildConfigPath: string, values: IosSplashConfigValues): void {
  const current = readFileSync(buildConfigPath, "utf-8");
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}`);

  if (!pattern.test(current)) {
    throw new Error(`No ${START} marker found in ${buildConfigPath}`);
  }

  const lines = [
    `    static let splashEnabled = ${values.enabled}`,
    `    static let splashMinDurationMs: Double = ${values.minDurationMs}`,
    `    static let splashFadeOutMs: Double = ${values.fadeOutDurationMs}`,
  ].join("\n");

  const block = `${START}\n${lines}\n    ${END}`;
  writeFileSync(buildConfigPath, current.replace(pattern, block));
}
