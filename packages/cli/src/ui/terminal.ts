/** Matches ANSI escape sequences (colours and cursor control). */
/**
 * All CLI output goes through this module. It keeps a single status line (the spinner) at the bottom of the
 * terminal, writes normal lines above it, and copies every line to the run log.
 */

const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Removes colours and other escape sequences. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * How output behaves.
 *
 * - `debug`: print every line of tool output (`--debug`).
 * - `interactive`: the terminal can redraw a status line and read keys.
 * - `unicode`: the terminal can show Unicode symbols.
 */
export interface UiSettings {
  debug: boolean;
  interactive: boolean;
  unicode: boolean;
}

/** A real terminal, not CI and not a dumb terminal. */
function detectInteractive(): boolean {
  return process.stdout.isTTY === true && !process.env.CI && process.env.TERM !== "dumb";
}

/** Unicode is safe outside the Linux console and, on Windows, in modern terminals. */
function detectUnicode(): boolean {
  if (process.platform !== "win32") return process.env.TERM !== "linux";
  return Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM === "vscode" || process.env.ConEmuTask);
}

const settings: UiSettings = { debug: false, interactive: detectInteractive(), unicode: detectUnicode() };

/** Overrides detected settings, for example from `--debug`. */
export function configureUi(overrides: Partial<UiSettings>): void {
  Object.assign(settings, overrides);
}

/** The current output settings. */
export function uiSettings(): Readonly<UiSettings> {
  return settings;
}

/** Whether to show a spinner rather than plain progress lines. */
export function canAnimate(): boolean {
  return settings.interactive && !settings.debug;
}

/** Where output goes. Tests swap these to capture output. */
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

/** Redirects output; `null` restores stdout and stderr. */
export function setTerminalStreams(next: TerminalStreams | null): void {
  streams = next ?? defaultStreams;
  statusDrawn = false;
}

/** Sets where every written line is copied (the run log), without colours. */
export function setLogSink(sink: ((line: string) => void) | null): void {
  logSink = sink;
}

/** Erases the status line if it is on screen. */
function clearStatus(): void {
  if (!statusDrawn) return;
  streams.out("\r\x1b[2K");
  statusDrawn = false;
}

/** Shortens text to `max` visible characters so the status line never wraps. */
function truncateVisible(text: string, max: number): string {
  if (stripAnsi(text).length <= max) return text;
  const plain = stripAnsi(text);
  return `${plain.slice(0, Math.max(0, max - 1))}…`;
}

/** Redraws the status line, if there is one. */
function drawStatus(): void {
  if (status === null) return;
  streams.out(`\r\x1b[2K${truncateVisible(status, Math.max(10, streams.columns() - 1))}`);
  statusDrawn = true;
}

/** Writes a line above the status line and copies it to the log. */
export function writeLine(text = "", stream: "out" | "err" = "out"): void {
  clearStatus();
  const write = stream === "err" ? streams.err : streams.out;
  write(`${text}\n`);
  if (logSink) for (const line of stripAnsi(text).split("\n")) logSink(line);
  drawStatus();
}

/** Copies a line to the log without showing it. */
export function logOnly(text: string): void {
  logSink?.(stripAnsi(text));
}

/** Shows text on the status line, or removes it with `null`. */
export function setStatus(text: string | null): void {
  status = text;
  if (text === null) clearStatus();
  else drawStatus();
}

/** Clears the terminal and its scrollback, keeping the status line. */
export function clearScreen(): void {
  statusDrawn = false;
  streams.out("\x1b[2J\x1b[3J\x1b[H");
  drawStatus();
}
