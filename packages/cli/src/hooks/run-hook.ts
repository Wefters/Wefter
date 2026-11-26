/**
 * Project hooks: `package.json` scripts named `wefter:<command>:<before|after>` run around `sync`,
 * `build` and `run`.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Commands that run hooks. */
export type HookCommand = "sync" | "build" | "run";
/** When a hook runs relative to its command. */
export type HookPhase = "before" | "after";

/** Extra information passed to hooks as environment variables. */
export interface HookContext {
  platform?: "android" | "ios";
  environment?: string;
}

/** The package manager the project uses, from its lockfile. */
function detectPackageManager(projectDir: string): "npm" | "pnpm" | "yarn" {
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

/** Whether `package.json` defines a script with this name. */
function hookScriptExists(projectDir: string, hookName: string): boolean {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return typeof pkg.scripts?.[hookName] === "string";
  } catch {
    return false;
  }
}

/**
 * Runs the hook script for `command` and `phase`, if the project defines one.
 *
 * The script gets `WEFTER_COMMAND`, `WEFTER_PHASE`, `WEFTER_PLATFORM`, `WEFTER_ENV` and
 * `WEFTER_PROJECT_DIR` in its environment, and its output is shown as is.
 *
 * @throws {Error} When the script exits with a non-zero code, which stops the command.
 */
export async function runHook(
  projectDir: string,
  command: HookCommand,
  phase: HookPhase,
  context: HookContext = {},
): Promise<void> {
  const hookName = `wefter:${command}:${phase}`;
  if (!hookScriptExists(projectDir, hookName)) return;

  const pm = detectPackageManager(projectDir);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pm, ["run", hookName], {
      cwd: projectDir,
      stdio: "inherit",
      env: {
        ...process.env,
        WEFTER_COMMAND: command,
        WEFTER_PHASE: phase,
        WEFTER_PLATFORM: context.platform ?? "",
        WEFTER_ENV: context.environment ?? "",
        WEFTER_PROJECT_DIR: projectDir,
      },
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Hook "${hookName}" exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}
