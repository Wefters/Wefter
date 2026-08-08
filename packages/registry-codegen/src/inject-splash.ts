import { readFileSync, writeFileSync } from "node:fs";

const START = "// WEFTER-SPLASH-CONFIG-START";
const END = "// WEFTER-SPLASH-CONFIG-END";

export interface SplashConfigValues {
  enabled: boolean;
  minDurationMs: number;
  fadeOutDurationMs: number;
}

export function injectSplashConfig(buildGradlePath: string, values: SplashConfigValues): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  const pattern = new RegExp(`(${START})[\\s\\S]*?(${END})`);

  if (!pattern.test(current)) {
    throw new Error(`No ${START} marker found in ${buildGradlePath}`);
  }

  const lines = [
    `        buildConfigField("boolean", "SPLASH_ENABLED", "${values.enabled}")`,
    `        buildConfigField("long", "SPLASH_MIN_DURATION_MS", "${values.minDurationMs}L")`,
    `        buildConfigField("long", "SPLASH_FADE_OUT_MS", "${values.fadeOutDurationMs}L")`,
  ].join("\n");

  const updated = current.replace(pattern, `$1\n${lines}\n        $2`);
  writeFileSync(buildGradlePath, updated);
}
