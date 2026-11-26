/**
 * Runs build tools (Gradle, xcodebuild, adb, simctl) quietly: their output is captured and logged rather
 * than printed, and a failure is turned into a short diagnosis.
 */

import { spawn } from "node:child_process";
import chalk from "chalk";
import { activeRunLog } from "./run-log.js";
import { logOnly, uiSettings, writeLine } from "../ui/terminal.js";

/** What went wrong, as found in a tool's output: the error lines and suggestions for fixing them. */
export interface Diagnosis {
  errors: string[];
  hints: string[];
}

/** Reads a tool's full output and picks out its errors and hints. */
export type Diagnose = (lines: string[]) => Diagnosis;

/**
 * Options for {@link runProcess}.
 *
 * - `tool`: name shown to the user, for example "Gradle".
 * - `onLine`: receives each line in quiet mode, for progress reporting.
 * - `diagnose`: explains a failure from the output.
 * - `failureMessage`: headline for a failure with the given exit code.
 */
export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  tool: string;
  onLine?: (line: string) => void;
  diagnose?: Diagnose;
  failureMessage?: (exitCode: number | null) => string;
}

/** A tool that failed or could not be started, with what went wrong. */
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

/** Most lines kept in memory for diagnosis; the log file has everything. */
const MAX_CAPTURED_LINES = 50_000;
const FALLBACK_TAIL_LINES = 20;

/** The last `count` non-blank lines, used when nothing specific was recognised. */
export function tailLines(lines: string[], count = FALLBACK_TAIL_LINES): string[] {
  return lines.filter((line) => line.trim() !== "").slice(-count);
}

/** A command as it would be typed, quoting arguments that need it. */
function describeCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => (/[\s"']/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

/**
 * Runs a command to completion.
 *
 * In quiet mode each line goes to the log and to `onLine`; with `--debug` it is printed as it arrives. The
 * command and its exit status are logged either way.
 *
 * @returns Every line of output.
 * @throws {ProcessFailure} When the command exits with a non-zero code or cannot be started.
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

    proc.on("exit", (code: number | null) => {
      exitCode = code;
      if (!proc.stdout && !proc.stderr) finish(code);
    });
    proc.on("close", (code: number | null) => finish(code ?? exitCode));
  });
}
