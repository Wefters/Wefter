/** The summaries the CLI prints when a run or build finishes, and the failure report when it does not. */

import chalk from "chalk";
import { ProcessFailure } from "../process/run-process.js";
import { activeRunLog } from "../process/run-log.js";
import { formatElapsed, symbols } from "./steps.js";
import { uiSettings, writeLine } from "./terminal.js";

/** Keyboard shortcuts available while `wefter run --watch` is running. */
export const SHORTCUTS: [key: string, action: string][] = [
  ["r", "reload app"],
  ["Ctrl+R", "rebuild native"],
  ["o", "open DevTools"],
  ["c", "clear"],
  ["h", "help"],
  ["q", "quit"],
];

/** All shortcuts on one line, for the run summary. */
export function shortcutsLine(): string {
  return SHORTCUTS.map(([key, action]) => `${chalk.bold(key)} ${chalk.dim(action)}`).join(chalk.dim(" · "));
}

/** Lists the shortcuts one per line (the `h` key). */
export function printShortcutHelp(): void {
  writeLine("");
  for (const [key, action] of SHORTCUTS) writeLine(`  ${chalk.bold(key.padEnd(7))} ${action}`);
  writeLine("");
}

/** What {@link printRunSummary} shows. */
export interface RunSummary {
  appName: string;
  targetName: string;
  buildMs: number;
  devServerUrl?: string | null;
  devtoolsUrl?: string | null;
  shortcuts: boolean;
}

/**
 * Prints that the app is running, how long the build took, the dev server and DevTools URLs when watching,
 * and the shortcuts when keys are being read.
 */
export function printRunSummary(summary: RunSummary): void {
  const sym = symbols();
  writeLine("");
  writeLine(
    `${chalk.green(sym.ok)} ${chalk.bold(summary.appName)} is running on ${chalk.bold(summary.targetName)}` +
      chalk.dim(` · built in ${formatElapsed(summary.buildMs)}`),
  );
  if (summary.devServerUrl) {
    writeLine("");
    writeLine(`  ${chalk.dim("Dev server".padEnd(10))}  ${chalk.cyan(summary.devServerUrl)}`);
    if (summary.devtoolsUrl) writeLine(`  ${chalk.dim("DevTools".padEnd(10))}  ${chalk.cyan(summary.devtoolsUrl)}`);
  }
  if (summary.shortcuts) {
    writeLine("");
    writeLine(`  ${shortcutsLine()}`);
  }
  writeLine("");
}

/** What {@link printBuildSummary} shows. */
export interface BuildSummary {
  appName: string;
  platformLabel: string;
  artifactPath: string;
  sizeLabel: string;
  plugins: string[];
}

/** Prints where the built app is, its size and the plugins it includes. */
export function printBuildSummary(summary: BuildSummary): void {
  const sym = symbols();
  writeLine("");
  writeLine(`${chalk.green(sym.ok)} Built ${chalk.bold(summary.appName)} ${chalk.dim(`(${summary.platformLabel})`)}`);
  writeLine(`  ${chalk.cyan(summary.artifactPath)} ${chalk.dim(`· ${summary.sizeLabel}`)}`);
  if (summary.plugins.length > 0) {
    writeLine(
      `  ${chalk.dim(`${summary.plugins.length} plugin${summary.plugins.length === 1 ? "" : "s"}:`)} ${summary.plugins.join(", ")}`,
    );
  }
  writeLine("");
}

/**
 * The same command with `--debug` added, suggested after a failure.
 *
 * @example debugRetryCommand({ command: "run", platform: "ios", flags: ["--watch"] }) // "wefter run ios
 *   --watch --debug"
 */
export function debugRetryCommand(parts: { command: string; platform: string; flags: string[] }): string {
  return ["wefter", parts.command, parts.platform, ...parts.flags, "--debug"].join(" ");
}

/**
 * Prints a failure to stderr.
 *
 * For a {@link ProcessFailure} it shows the tool's message, the errors found in its output and hints on how
 * to fix them; for any other error, its message. It then points to the full run log and, unless already in
 * debug mode, to `retryWithDebug`.
 */
export function printFailure(title: string, error: unknown, retryWithDebug?: string): void {
  const sym = symbols();
  writeLine("", "err");

  if (error instanceof ProcessFailure) {
    writeLine(`${chalk.red(sym.fail)} ${chalk.bold(title)} ${chalk.dim(`— ${error.message}`)}`, "err");
    const { errors, hints } = error.diagnosis;
    if (errors.length > 0) {
      writeLine("", "err");
      for (const line of errors) writeLine(`  ${chalk.red(line)}`, "err");
    }
    if (hints.length > 0) {
      writeLine("", "err");
      for (const hint of hints) writeLine(`  ${chalk.yellow(sym.arrow)} ${hint}`, "err");
    }
  } else {
    const message = error instanceof Error ? error.message : String(error);
    const [first, ...rest] = message.split("\n");
    writeLine(`${chalk.red(sym.fail)} ${chalk.bold(title)}`, "err");
    writeLine("", "err");
    writeLine(`  ${first}`, "err");
    for (const line of rest) writeLine(`  ${line}`, "err");
  }

  const log = activeRunLog();
  const debugging = uiSettings().debug;
  if (log || (retryWithDebug && !debugging)) writeLine("", "err");
  if (log) writeLine(`  ${chalk.dim("Full log".padEnd(8))}  ${log.displayPath}`, "err");
  if (retryWithDebug && !debugging) writeLine(`  ${chalk.dim("More".padEnd(8))}  ${retryWithDebug}`, "err");
  writeLine("", "err");
}
