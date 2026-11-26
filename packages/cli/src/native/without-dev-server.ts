/**
 * Builds with the dev server address cleared. `wefter run --watch` writes the address into the native
 * project and it stays there until the next sync; an app built from that project would open the dev server
 * instead of its bundled web app and show a blank page once the server is gone.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resetDevServerUrl } from "./inject-dev-server.js";
import { resetDevServerUrlIos } from "./inject-dev-server-ios.js";

/**
 * Runs `build` with the dev server address cleared from `file`, then puts the file back as it was, so a
 * `wefter run --watch` session that is still running keeps its address. A missing file is left alone.
 */
async function withDevServerCleared<T>(
  file: string,
  reset: (file: string) => void,
  build: () => Promise<T>,
): Promise<T> {
  if (!existsSync(file)) return build();
  const original = readFileSync(file, "utf-8");
  reset(file);
  try {
    return await build();
  } finally {
    if (readFileSync(file, "utf-8") !== original) writeFileSync(file, original);
  }
}

/** Runs `build` with the dev server address cleared from the Android `build.gradle.kts`. */
export function withoutDevServerAndroid<T>(buildGradlePath: string, build: () => Promise<T>): Promise<T> {
  return withDevServerCleared(buildGradlePath, resetDevServerUrl, build);
}

/** Runs `build` with the dev server address cleared from the iOS `BuildConfig.swift`. */
export function withoutDevServerIos<T>(buildConfigPath: string, build: () => Promise<T>): Promise<T> {
  return withDevServerCleared(buildConfigPath, resetDevServerUrlIos, build);
}
