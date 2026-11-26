import chalk from "chalk";
import { canAnimate, setStatus, uiSettings, writeLine } from "./terminal.js";

const UNICODE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASCII_FRAMES = ["-", "\\", "|", "/"];
const FRAME_MS = 80;

export function symbols(): { ok: string; fail: string; bullet: string; arrow: string } {
  return uiSettings().unicode
    ? { ok: "✔", fail: "✖", bullet: "•", arrow: "›" }
    : { ok: "√", fail: "×", bullet: "*", arrow: ">" };
}

export function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export interface StepHandle {
  /** Live detail shown after the label while the step runs, e.g. "Compiling ViewController.swift". */
  detail(text: string): void;
}

export interface StepOptions<T> {
  /** Label printed when the step succeeds (defaults to the running label). */
  done?: (result: T) => string;
}

/**
 * Runs one unit of work and reports it:
 * - in a terminal: a spinner with live detail, replaced by `✔ label  1.2s` / `✖ label  3.4s`;
 * - in CI, piped output or --debug: `› label…` when it starts and the same result line at the end.
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
