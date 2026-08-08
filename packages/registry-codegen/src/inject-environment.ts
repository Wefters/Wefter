import { readFileSync, writeFileSync } from "node:fs";

const START = "// WEFTER-ENV-CONFIG-START";
const END = "// WEFTER-ENV-CONFIG-END";

export interface EnvironmentValues {
  appId: string;
  appName: string;
}

export function injectEnvironmentConfig(buildGradlePath: string, env: string, values: EnvironmentValues): void {
  const current = readFileSync(buildGradlePath, "utf-8");
  const pattern = new RegExp(`(create\\("${env}"\\)\\s*\\{[\\s\\S]*?${START})[\\s\\S]*?(${END})`);

  if (!pattern.test(current)) {
    throw new Error(`No productFlavor "${env}" found in ${buildGradlePath}`);
  }

  const lines = [
    `            applicationId = ${JSON.stringify(values.appId)}`,
    `            resValue("string", "app_name", ${JSON.stringify(values.appName)})`,
  ].join("\n");

  const updated = current.replace(pattern, `$1\n${lines}\n            $2`);
  writeFileSync(buildGradlePath, updated);
}
