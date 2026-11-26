/**
 * Single place that writes to the terminal.
 *
 * Everything the CLI prints (logger lines, forwarded Vite output, step results, `--debug` child
 * output) goes through `writeLine`, so a live status line (the spinner) can be cleared before a
 * line is printed and redrawn after it. Without this, any output arriving while a build is running
 * would land in the middle of the spinner. Every printed line is also copied (without colours) to
 * the active run log, if one is open.
 */

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export interface UiSettings {
  /** `--debug`: stream every tool's output live and print extra diagnostics. */
  debug: boolean;
  /** A real terminal (not CI, not piped): spinners and keyboard shortcuts are allowed. */
  interactive: boolean;
  /** The terminal can render the braille spinner and ✔/✖ glyphs. */
  unicode: boolean;
}

function detectInteractive(): boolean {
  return process.stdout.isTTY === true && !process.env.CI && process.env.TERM !== "dumb";
}

function detectUnicode(): boolean {
  if (process.platform !== "win32") return process.env.TERM !== "linux";
  return Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM === "vscode" || process.env.ConEmuTask);
}

const settings: UiSettings = { debug: false, interactive: detectInteractive(), unicode: detectUnicode() };

export function configureUi(overrides: Partial<UiSettings>): void {
  Object.assign(settings, overrides);
}

export function uiSettings(): Readonly<UiSettings> {
  return settings;
}

/** Spinners animate only in a real terminal and never in --debug (tool output streams there). */
export function canAnimate(): boolean {
  return settings.interactive && !settings.debug;
}

export interface TerminalStreams {
  out: (chunk: string) => void;
  err: (chunk: string) => void;
  columns: () => number;
}

const defaultStreams: TerminalStreams = {
  out: (chunk) => process.stdout.write(chunk),
  err: (chunk) => process.stderr.write(chunk),
  columns: () => process.stdout.columns || 80,
};

let streams: TerminalStreams = defaultStreams;
let logSink: ((line: string) => void) | null = null;
let status: string | null = null;
let statusDrawn = false;

/** Tests swap the real stdout/stderr for in-memory writers. */
export function setTerminalStreams(next: TerminalStreams | null): void {
  streams = next ?? defaultStreams;
  statusDrawn = false;
}

export function setLogSink(sink: ((line: string) => void) | null): void {
  logSink = sink;
}

function clearStatus(): void {
  if (!statusDrawn) return;
  streams.out("\r\x1b[2K");
  statusDrawn = false;
}

function truncateVisible(text: string, max: number): string {
  if (stripAnsi(text).length <= max) return text;
  // Status lines are built from short coloured segments; dropping colour when truncating keeps
  // the width maths simple and the terminal tidy.
  const plain = stripAnsi(text);
  return `${plain.slice(0, Math.max(0, max - 1))}…`;
}

function drawStatus(): void {
  if (status === null) return;
  streams.out(`\r\x1b[2K${truncateVisible(status, Math.max(10, streams.columns() - 1))}`);
  statusDrawn = true;
}

/** Print one line above the status line (if any). Multi-line text is split so the log stays tidy. */
export function writeLine(text = "", stream: "out" | "err" = "out"): void {
  clearStatus();
  const write = stream === "err" ? streams.err : streams.out;
  write(`${text}\n`);
  if (logSink) for (const line of stripAnsi(text).split("\n")) logSink(line);
  drawStatus();
}

/** Copy a line to the run log only (e.g. a tool's output while it is being captured quietly). */
export function logOnly(text: string): void {
  logSink?.(stripAnsi(text));
}

/** Show (or with `null`, remove) the live status line at the bottom of the output. */
export function setStatus(text: string | null): void {
  status = text;
  if (text === null) clearStatus();
  else drawStatus();
}

/** Wipe the visible screen and scrollback (the `c` shortcut). */
export function clearScreen(): void {
  statusDrawn = false;
  streams.out("\x1b[2J\x1b[3J\x1b[H");
  drawStatus();
}
