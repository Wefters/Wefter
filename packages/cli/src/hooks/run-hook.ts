import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type HookCommand = "sync" | "build" | "run";
export type HookPhase = "before" | "after";

export interface HookContext {
  platform?: "android" | "ios";
  environment?: string;
}

function detectPackageManager(projectDir: string): "npm" | "pnpm" | "yarn" {
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

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
