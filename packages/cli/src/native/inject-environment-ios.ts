import { readFileSync, writeFileSync } from "node:fs";

const START = "// WEFTER-ENV-CONFIG-START";
const END = "// WEFTER-ENV-CONFIG-END";

export interface IosEnvironmentValues {
  bundleId: string;
  appName: string;
}

export function injectEnvironmentConfigIos(xcconfigPath: string, values: IosEnvironmentValues): void {
  const current = readFileSync(xcconfigPath, "utf-8");
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}`);

  if (!pattern.test(current)) {
    throw new Error(`No ${START} marker found in ${xcconfigPath}`);
  }

  
  
  
  
  
  const lines = [`PRODUCT_BUNDLE_IDENTIFIER = ${values.bundleId}`, `PRODUCT_NAME = ${values.appName}`].join("\n");

  const block = `${START}\n${lines}\n${END}`;
  writeFileSync(xcconfigPath, current.replace(pattern, block));
}
