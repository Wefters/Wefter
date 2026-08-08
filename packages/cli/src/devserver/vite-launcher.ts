import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import logger from "../utils/logger.js";

export interface DevServer {
  url: string;
  process: ChildProcess;
  stop(): void;
}

export function startDevServer(projectDir: string, lanIp: string, port = 5173): Promise<DevServer> {
  const url = `http://${lanIp}:${port}`;

  const viteBin = join(projectDir, "node_modules/.bin/vite");
  if (!existsSync(viteBin)) {
    return Promise.reject(new Error(`vite not found at ${viteBin} — run npm install in ${projectDir} first.`));
  }

  logger.info(`Starting Vite dev server on ${chalk.cyan(url)}...`);

  return new Promise((resolve, reject) => {
    const proc = spawn(viteBin, ["--host", "0.0.0.0", "--port", String(port), "--strictPort"], {
      cwd: projectDir,
      stdio: "pipe",
    });

    let resolved = false;
    proc.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (!resolved && text.includes("ready")) {
        resolved = true;
        logger.success(`Vite dev server ready at ${chalk.cyan(url)}`);
        resolve({ url, process: proc, stop: () => proc.kill() });
      }
    });

    proc.stderr?.on("data", (chunk) => process.stderr.write(chunk.toString()));

    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (!resolved) reject(new Error(`Vite dev server exited early with code ${code}`));
    });
  });
}
