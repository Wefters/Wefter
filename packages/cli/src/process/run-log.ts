import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { setLogSink } from "../ui/terminal.js";

/**
 * A plain-text log of one CLI command: every line the CLI printed, every tool it ran (command,
 * working directory, exit code, duration) and all of that tool's output. Written synchronously so
 * the file is complete even if the process is killed mid-build.
 */
export interface RunLog {
  path: string;
  /** Path relative to the project, for printing. */
  displayPath: string;
  append(line: string): void;
}

export const RUN_LOG_DIR = ".wefter/logs";
export const RUN_LOGS_KEPT = 10;

let active: RunLog | null = null;

export function activeRunLog(): RunLog | null {
  return active;
}

function timestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/:/g, "-");
}

/** Deletes the oldest `.log` files so at most `keep` remain. */
export function pruneRunLogs(dir: string, keep = RUN_LOGS_KEPT): void {
  let entries: { path: string; mtime: number }[];
  try {
    entries = readdirSync(dir)
      .filter((name) => name.endsWith(".log"))
      .map((name) => {
        const path = join(dir, name);
        return { path, mtime: statSync(path).mtimeMs };
      });
  } catch {
    return;
  }
  entries.sort((a, b) => b.mtime - a.mtime || b.path.localeCompare(a.path));
  for (const old of entries.slice(keep)) rmSync(old.path, { force: true });
}

/**
 * Opens `.wefter/logs/<name>-<time>.log`, makes it the active log (so printed lines and tool
 * output are copied into it) and prunes old logs. Returns null if the directory can't be written;
 * logging is a convenience and must never stop a build.
 */
export function openRunLog(projectDir: string, name: string, now = new Date()): RunLog | null {
  const dir = join(projectDir, RUN_LOG_DIR);
  const path = join(dir, `${name}-${timestamp(now)}.log`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `wefter ${name} — ${now.toISOString()}\nproject: ${projectDir}\n\n`);
    pruneRunLogs(dir);
  } catch {
    return null;
  }

  let broken = false;
  const log: RunLog = {
    path,
    displayPath: relative(process.cwd(), path) || path,
    append(line) {
      if (broken) return;
      try {
        appendFileSync(path, `${line}\n`);
      } catch {
        broken = true;
      }
    },
  };
  active = log;
  setLogSink((line) => log.append(line));
  return log;
}

export function closeRunLog(): void {
  active = null;
  setLogSink(null);
}
