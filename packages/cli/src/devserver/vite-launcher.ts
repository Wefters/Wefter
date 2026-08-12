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

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const VITE_READY_LINE = /^VITE\s+v[\d.]+\s+ready in/i;
const VITE_ADDRESS_LINE = /^➜\s+(Local|Network):/;
const VITE_TIMESTAMPED_LINE = /^\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\s*\[vite\]\s*(.*)$/i;

function forwardViteLine(rawLine: string): void {
  const line = rawLine.replace(ANSI_PATTERN, "").trim();
  if (line === "") return;
  if (VITE_READY_LINE.test(line)) return;
  if (VITE_ADDRESS_LINE.test(line)) return;

  const timestamped = line.match(VITE_TIMESTAMPED_LINE);
  if (timestamped) {
    logger.info(`[vite] ${timestamped[1].trim()}`);
    return;
  }

  logger.info(`[vite] ${line}`);
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
    let stdoutBuffer = "";
    proc.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutBuffer += text;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) forwardViteLine(line);

      if (!resolved && text.includes("ready")) {
        resolved = true;
        logger.success(`Vite dev server ready at ${chalk.cyan(url)}`);
        resolve({ url, process: proc, stop: () => proc.kill() });
      }
    });

    proc.stderr?.on("data", (chunk) => process.stderr.write(chunk.toString()));

    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (stdoutBuffer) forwardViteLine(stdoutBuffer);
      if (!resolved) reject(new Error(`Vite dev server exited early with code ${code}`));
    });
  });
}
