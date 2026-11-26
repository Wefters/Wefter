/**
 * Each `run` and `build` writes everything (commands, full tool output and CLI messages) to a log file in
 * `.wefter/logs`, so a quiet run can still be investigated.
 */

import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { setLogSink } from "../ui/terminal.js";

/** An open run log. */
export interface RunLog {
  path: string;
  displayPath: string;
  append(line: string): void;
}

/** Folder for run logs, relative to the project. */
export const RUN_LOG_DIR = ".wefter/logs";
/** How many logs are kept; older ones are deleted. */
export const RUN_LOGS_KEPT = 10;

let active: RunLog | null = null;

/** The log of the current command, if one is open. */
export function activeRunLog(): RunLog | null {
  return active;
}

/** A file-name-safe timestamp, such as `2026-11-25T14-03-12`. */
function timestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/:/g, "-");
}

/** Deletes all but the newest `keep` logs in `dir`. */
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
 * Starts a log named `<name>-<timestamp>.log` and routes all output into it.
 *
 * @returns The log, or `null` when it cannot be written (logging is then skipped, not fatal).
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

/** Stops writing to the current log. */
export function closeRunLog(): void {
  active = null;
  setLogSink(null);
}
