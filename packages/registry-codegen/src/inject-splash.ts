import { readFileSync, writeFileSync } from "node:fs";

const START = "// WEFTER-SPLASH-CONFIG-START";
const END = "// WEFTER-SPLASH-CONFIG-END";

export interface SplashConfigValues {
  enabled: boolean;
  minDuration: number;
  maxDuration: number;
  dismissOn: "ready" | "timer";
  transition: "fade" | "none";
}

export function injectSplashConfig(buildGradlePath: string, values: SplashConfigValues): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  const pattern = new RegExp(`(${START})[\\s\\S]*?(${END})`);

  if (!pattern.test(current)) {
    throw new Error(`No ${START} marker found in ${buildGradlePath}`);
  }

  const lines = [
    `        buildConfigField("boolean", "SPLASH_ENABLED", "${values.enabled}")`,
    `        buildConfigField("long", "SPLASH_MIN_DURATION_MS", "${values.minDuration}L")`,
    `        buildConfigField("long", "SPLASH_MAX_DURATION_MS", "${values.maxDuration}L")`,
    `        buildConfigField("boolean", "SPLASH_WAIT_FOR_READY", "${values.dismissOn === "ready"}")`,
    `        buildConfigField("boolean", "SPLASH_FADE_TRANSITION", "${values.transition === "fade"}")`,
  ].join("\n");

  const updated = current.replace(pattern, `$1\n${lines}\n        $2`);
  writeFileSync(buildGradlePath, updated);
}
