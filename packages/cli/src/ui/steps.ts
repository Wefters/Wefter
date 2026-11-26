/** Progress steps: a spinner while work runs, then a ✔ or ✖ line with how long it took. */

import chalk from "chalk";
import { canAnimate, setStatus, uiSettings, writeLine } from "./terminal.js";

/** Spinner frames for terminals that can show Unicode; {@link ASCII_FRAMES} for the rest. */
const UNICODE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASCII_FRAMES = ["-", "\\", "|", "/"];
const FRAME_MS = 80;

/** Status symbols, in ASCII when the terminal cannot show Unicode. */
export function symbols(): { ok: string; fail: string; bullet: string; arrow: string } {
  return uiSettings().unicode
    ? { ok: "✔", fail: "✖", bullet: "•", arrow: "›" }
    : { ok: "√", fail: "×", bullet: "*", arrow: ">" };
}

/** `4.2s` under a minute, `1m 05s` after that. */
export function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Lets the work of a step update the text shown next to its spinner. */
export interface StepHandle {
  detail(text: string): void;
}

/** Options for {@link step}. */
export interface StepOptions<T> {
  done?: (result: T) => string;
}

/**
 * Runs `work` as one visible step.
 *
 * In an interactive terminal a spinner shows `label` and the latest detail; otherwise (CI, piped output or
 * `--debug`) a plain `› label…` line is written first. When the work ends, a ✔ line (using `options.done`
 * for the text, if given) or a ✖ line is written with the elapsed time.
 *
 * @returns Whatever `work` resolves to; its error is rethrown.
 *
 * @example
 * const plugins = await step("Syncing plugins", async (s) => {
 *   s.detail("copying native source");
 *   return syncPlugins();
 * });
 */
export async function step<T>(
  label: string,
  work: (handle: StepHandle) => Promise<T>,
  options: StepOptions<T> = {},
): Promise<T> {
  const started = Date.now();
  const sym = symbols();
  const animate = canAnimate();
  let detail = "";
  let frame = 0;
  let timer: NodeJS.Timeout | null = null;

  const frames = uiSettings().unicode ? UNICODE_FRAMES : ASCII_FRAMES;
  const render = () => {
    const spinner = chalk.cyan(frames[frame % frames.length]);
    setStatus(`${spinner} ${label}${detail ? chalk.dim(` · ${detail}`) : ""}`);
  };

  if (animate) {
    render();
    timer = setInterval(() => {
      frame++;
      render();
    }, FRAME_MS);
    timer.unref?.();
  } else {
    writeLine(chalk.dim(`${sym.arrow} ${label}…`));
  }

  const finish = () => {
    if (timer) clearInterval(timer);
    if (animate) setStatus(null);
  };

  try {
    const result = await work({
      detail(text) {
        detail = text;
        if (animate) render();
      },
    });
    finish();
    const doneLabel = options.done ? options.done(result) : label;
    writeLine(`${chalk.green(sym.ok)} ${doneLabel}  ${chalk.dim(formatElapsed(Date.now() - started))}`);
    return result;
  } catch (err) {
    finish();
    writeLine(`${chalk.red(sym.fail)} ${label}  ${chalk.dim(formatElapsed(Date.now() - started))}`);
    throw err;
  }
}
