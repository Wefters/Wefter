import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import logger from "../utils/logger.js";
import { writeLine } from "../ui/terminal.js";

export interface DevServer {
  url: string;
  devtoolsUrl: Promise<string | null>;
  process: ChildProcess;
  stop(): void;
  /** Called if Vite exits after it was ready (crash, port taken later, killed). */
  onExit(listener: (code: number | null) => void): void;
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const VITE_READY_LINE = /^VITE\s+v[\d.]+\s+ready in/i;
const VITE_ADDRESS_LINE = /^➜\s+(Local|Network):/;
const VITE_TIMESTAMPED_LINE = /^\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\s*\[vite\]\s*(.*)$/i;

const DEVTOOLS_DASHBOARD_ROUTE = "/__wefter-devtools";
const DEVTOOLS_PLUGINS_API_ROUTE = "/__wefter-devtools/api/plugins";
const DEVTOOLS_PROBE_TIMEOUT_MS = 1500;

async function probeDevtoolsUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(`${url}${DEVTOOLS_PLUGINS_API_ROUTE}`, {
      signal: AbortSignal.timeout(DEVTOOLS_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    if (!(response.headers.get("content-type") ?? "").includes("application/json")) return null;
    return `${url}${DEVTOOLS_DASHBOARD_ROUTE}`;
  } catch {
    return null;
  }
}

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

  return new Promise((resolve, reject) => {
    const proc = spawn(viteBin, ["--host", "0.0.0.0", "--port", String(port), "--strictPort"], {
      cwd: projectDir,
      stdio: "pipe",
    });

    let resolved = false;
    let stopping = false;
    const exitListeners: ((code: number | null) => void)[] = [];
    let stdoutBuffer = "";
    proc.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutBuffer += text;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) forwardViteLine(line);

      if (!resolved && text.includes("ready")) {
        resolved = true;
        const devtoolsUrl = probeDevtoolsUrl(url);
        resolve({
          url,
          devtoolsUrl,
          process: proc,
          stop: () => {
            stopping = true;
            proc.kill();
          },
          onExit: (listener) => exitListeners.push(listener),
        });
      }
    });

    let stderrBuffer = "";
    proc.stderr?.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) writeLine(line, "err");
    });

    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (stdoutBuffer) forwardViteLine(stdoutBuffer);
      if (stderrBuffer.trim()) writeLine(stderrBuffer, "err");
      if (!resolved) reject(new Error(`Vite dev server exited early with code ${code}`));
      else if (!stopping) for (const listener of exitListeners) listener(code);
    });
  });
}
