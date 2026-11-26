import { spawn } from "node:child_process";
import chalk from "chalk";
import { activeRunLog } from "./run-log.js";
import { logOnly, uiSettings, writeLine } from "../ui/terminal.js";

/** What went wrong, in a form a person can act on. */
export interface Diagnosis {
  /** The actual error lines from the tool's output (compiler errors, install failures, …). */
  errors: string[];
  /** One-line fixes for problems we recognise. */
  hints: string[];
}

export type Diagnose = (lines: string[]) => Diagnosis;

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Name used in failure summaries, e.g. "Xcode", "Gradle", "adb". */
  tool: string;
  /** Called for every output line while output is captured quietly (drives spinner detail). */
  onLine?: (line: string) => void;
  /** Extracts the real errors from the output when the command fails. */
  diagnose?: Diagnose;
  /** Error message for a non-zero exit (defaults to "<command> <args> failed with exit code N"). */
  failureMessage?: (exitCode: number | null) => string;
}

/** A tool exited non-zero (or could not start). Carries enough to explain the failure. */
export class ProcessFailure extends Error {
  readonly tool: string;
  readonly exitCode: number | null;
  readonly diagnosis: Diagnosis;

  constructor(message: string, tool: string, exitCode: number | null, diagnosis: Diagnosis) {
    super(message);
    this.name = "ProcessFailure";
    this.tool = tool;
    this.exitCode = exitCode;
    this.diagnosis = diagnosis;
  }
}

/** Kept in memory for diagnosis; the full output is always in the run log. */
const MAX_CAPTURED_LINES = 50_000;
const FALLBACK_TAIL_LINES = 20;

export function tailLines(lines: string[], count = FALLBACK_TAIL_LINES): string[] {
  return lines.filter((line) => line.trim() !== "").slice(-count);
}

function describeCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => (/[\s"']/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

/**
 * Runs a tool with its output captured.
 *
 * Default mode: output goes to the run log only, and each line is handed to `onLine` (so a
 * spinner can show what the tool is doing). `--debug`: every line is also printed live, above any
 * status line. On failure the promise rejects with a `ProcessFailure` whose diagnosis lists the
 * real errors (via `diagnose`), falling back to the last lines of output.
 */
export function runProcess(command: string, args: string[], options: RunProcessOptions): Promise<string[]> {
  const debug = uiSettings().debug;
  const log = activeRunLog();
  const commandLine = describeCommand(command, args);
  const started = Date.now();

  log?.append(`\n$ ${commandLine}${options.cwd ? `\n  (in ${options.cwd})` : ""}`);
  if (debug) writeLine(chalk.dim(`[debug] $ ${commandLine}`));

  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let settled = false;
    let exitCode: number | null = null;

    const handleLine = (raw: string) => {
      const line = raw.replace(/\r$/, "");
      lines.push(line);
      if (lines.length > MAX_CAPTURED_LINES) lines.shift();
      if (debug) {
        writeLine(line);
      } else {
        logOnly(line);
        options.onLine?.(line);
      }
    };

    const lineReader = () => {
      let buffer = "";
      return {
        push(chunk: Buffer | string) {
          buffer += chunk.toString();
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) handleLine(part);
        },
        flush() {
          if (buffer) handleLine(buffer);
          buffer = "";
        },
      };
    };
    const out = lineReader();
    const err = lineReader();

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      out.flush();
      err.flush();
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      log?.append(`[exit ${code ?? "signal"} after ${seconds}s]`);
      if (code === 0) {
        resolve(lines);
        return;
      }
      const diagnosis = options.diagnose?.(lines) ?? { errors: [], hints: [] };
      if (diagnosis.errors.length === 0) diagnosis.errors = tailLines(lines);
      const message = options.failureMessage?.(code) ?? `${commandLine} failed with exit code ${code}`;
      reject(new ProcessFailure(message, options.tool, code, diagnosis));
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    proc.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => err.push(chunk));

    proc.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      log?.append(`[failed to start: ${error.message}]`);
      const hints = error.code === "ENOENT" ? [`\`${command}\` was not found. Is it installed and on your PATH?`] : [];
      reject(
        new ProcessFailure(`${command} could not be started: ${error.message}`, options.tool, null, {
          errors: [error.message],
          hints,
        }),
      );
    });

    // Real child processes emit "close" once their output streams have drained; finish there so no
    // trailing output is lost. A process without piped streams only ever emits "exit".
    proc.on("exit", (code: number | null) => {
      exitCode = code;
      if (!proc.stdout && !proc.stderr) finish(code);
    });
    proc.on("close", (code: number | null) => finish(code ?? exitCode));
  });
}
