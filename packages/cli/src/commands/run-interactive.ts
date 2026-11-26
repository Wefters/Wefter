/**
 * What `wefter run` does once the app is running: prints the summary and, while watching in a terminal,
 * handles the keyboard shortcuts until the user quits.
 */

import chalk from "chalk";
import type { RunSession } from "./run.js";
import { startKeySession, type KeyInput } from "./run-session.js";
import { reloadApp } from "../devserver/reload.js";
import { printFailure, printRunSummary, printShortcutHelp } from "../ui/report.js";
import { clearScreen, uiSettings, writeLine } from "../ui/terminal.js";
import { openUrl } from "../utils/open-url.js";
import { formatElapsed, step, symbols } from "../ui/steps.js";
import { activeRunLog } from "../process/run-log.js";

/** Options for {@link attachRunSession}. `input` and `exit` are replaced in tests. */
export interface AttachOptions {
  retryWithDebug: string;
  input?: KeyInput;
  exit?: (code: number) => void;
}

/** Prints the run summary. */
function showSummary(session: RunSession, shortcuts: boolean): void {
  printRunSummary({
    appName: session.appName,
    targetName: session.targetName,
    buildMs: session.buildMs,
    devServerUrl: session.devServer?.url,
    devtoolsUrl: session.devtoolsUrl,
    shortcuts,
  });
}

/**
 * Takes over after a successful run.
 *
 * - Without `--watch` it only prints the summary.
 * - Without an interactive terminal it prints the dev server URL and keeps running until Ctrl+C.
 * - Otherwise it handles the shortcuts. A failed reload or rebuild is reported and the session keeps
 *   running; if the dev server stops on its own, the CLI exits with code 1.
 *
 * @param options `retryWithDebug` is the command suggested after a failure.
 * @returns A function that stops the session and the dev server.
 */
export function attachRunSession(session: RunSession, options: AttachOptions): () => void {
  const input = options.input ?? process.stdin;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const devServer = session.devServer;
  const interactive = Boolean(devServer) && uiSettings().interactive && input.isTTY === true;

  showSummary(session, interactive);

  if (!devServer) return () => {};
  if (!interactive) {
    writeLine(chalk.dim(`Watching ${devServer.url}; edits hot-reload on the device. Press Ctrl+C to stop.`));
    return () => devServer.stop();
  }

  let stopKeys: () => void = () => {};
  let ended = false;
  /** Stops reading keys and the dev server, then exits with `code`. Runs once. */
  const shutdown = (code: number) => {
    if (ended) return;
    ended = true;
    stopKeys();
    devServer.stop();
    exit(code);
  };

  stopKeys = startKeySession(
    {
      async reload() {
        await step("Reloading app", () => reloadApp(devServer.url, () => session.restartApp()), {
          done: (outcome) =>
            outcome.kind === "reloaded"
              ? `Reloaded app${outcome.clients > 1 ? ` on ${outcome.clients} devices` : ""}`
              : "Restarted app (no web view was connected to reload)",
        });
      },
      async rebuild() {
        writeLine("");
        writeLine(chalk.bold("Rebuilding native app…"));
        const started = Date.now();
        await session.rebuild();
        writeLine(`${chalk.green(symbols().ok)} Rebuilt and relaunched in ${formatElapsed(Date.now() - started)}`);
        writeLine("");
      },
      async openDevtools() {
        const url = session.devtoolsUrl;
        if (!url) {
          writeLine(
            chalk.yellow(
              "DevTools isn't available: add @wefterjs/devtools to this project's Vite plugins to get the dashboard.",
            ),
          );
          return;
        }
        const opened = await openUrl(url);
        writeLine(opened ? chalk.dim(`Opened ${url}`) : `Open ${chalk.cyan(url)} in your browser.`);
      },
      clear() {
        clearScreen();
        showSummary(session, true);
      },
      help: printShortcutHelp,
      quit() {
        writeLine(chalk.dim("Stopping…"));
        shutdown(0);
      },
      reportError(action, error) {
        printFailure(action === "rebuild" ? "Rebuild failed" : "Reload failed", error, options.retryWithDebug);
        writeLine(chalk.dim("Still running. Fix the problem and press Ctrl+R to rebuild, or q to quit."));
      },
    },
    input,
  );

  devServer.onExit((code) => {
    const log = activeRunLog();
    printFailure(
      "The dev server stopped",
      new Error(
        `Vite exited unexpectedly (exit code ${code ?? "signal"}). Its last messages are above${log ? " and in the log" : ""}.`,
      ),
      options.retryWithDebug,
    );
    shutdown(1);
  });

  return () => shutdown(0);
}
