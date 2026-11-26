/** Starts the project's Vite dev server for `wefter run --watch` and forwards its messages. */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import logger from "../utils/logger.js";
import { writeLine } from "../ui/terminal.js";

/**
 * A running dev server.
 *
 * - `url`: the LAN address the app loads.
 * - `devtoolsUrl`: resolves to the dashboard URL, or `null` when the project does not use DevTools.
 * - `onExit`: called if the server stops on its own.
 */
export interface DevServer {
  url: string;
  devtoolsUrl: Promise<string | null>;
  process: ChildProcess;
  stop(): void;
  onExit(listener: (code: number | null) => void): void;
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
/** Vite's start-up lines, which the CLI replaces with its own summary. */
const VITE_READY_LINE = /^VITE\s+v[\d.]+\s+ready in/i;
const VITE_ADDRESS_LINE = /^➜\s+(Local|Network):/;
/** Vite's timestamped messages (HMR updates and so on); the timestamp is dropped. */
const VITE_TIMESTAMPED_LINE = /^\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\s*\[vite\]\s*(.*)$/i;

const DEVTOOLS_DASHBOARD_ROUTE = "/__wefter-devtools";
const DEVTOOLS_PLUGINS_API_ROUTE = "/__wefter-devtools/api/plugins";
const DEVTOOLS_PROBE_TIMEOUT_MS = 1500;

/** Checks whether DevTools is installed by calling its plugins API. */
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

/** Shows a line of Vite output as a `[vite]` message, skipping the start-up banner. */
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

/**
 * Starts Vite on all interfaces and resolves once it is ready.
 *
 * @param lanIp Address put in the returned URL.
 * @param port Port to use; Vite fails rather than picking another (`--strictPort`).
 * @throws {Error} When Vite is not installed or exits before it is ready.
 */
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
