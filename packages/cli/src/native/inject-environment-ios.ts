import { readFileSync, writeFileSync } from "node:fs";

const START = "// WEFTER-ENV-CONFIG-START";
const END = "// WEFTER-ENV-CONFIG-END";

/** Per-environment values written into an `.xcconfig` file. */
export interface IosEnvironmentValues {
  bundleId: string;
  appName: string;
  /** The environment's name, which the app reads from `WefterEnvironment` in `Info.plist`. */
  environment?: string;
}

/**
 * Writes the bundle identifier and product name of one environment into its `.xcconfig`, between the
 * `WEFTER-ENV-CONFIG` markers.
 *
 * @throws {Error} When the markers are missing.
 */
export function injectEnvironmentConfigIos(xcconfigPath: string, values: IosEnvironmentValues): void {
  const current = readFileSync(xcconfigPath, "utf-8");
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}`);

  if (!pattern.test(current)) {
    throw new Error(`No ${START} marker found in ${xcconfigPath}`);
  }

  const lines = [
    `PRODUCT_BUNDLE_IDENTIFIER = ${values.bundleId}`,
    `PRODUCT_NAME = ${values.appName}`,
    ...(values.environment ? [`WEFTER_ENVIRONMENT = ${values.environment}`] : []),
  ].join("\n");

  const block = `${START}\n${lines}\n${END}`;
  writeFileSync(xcconfigPath, current.replace(pattern, block));
}
