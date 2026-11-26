/**
 * Keyboard shortcuts while `wefter run --watch` is running. The terminal is put in raw mode so single key
 * presses arrive immediately.
 */

import chalk from "chalk";
import { writeLine } from "../ui/terminal.js";

/**
 * What each shortcut does. Errors from `reload` and `rebuild` go to `reportError` instead of ending the
 * session.
 */
export interface SessionActions {
  reload(): Promise<void>;
  rebuild(): Promise<void>;
  openDevtools(): Promise<void> | void;
  clear(): void;
  help(): void;
  quit(): Promise<void> | void;
  reportError(action: "reload" | "rebuild", error: unknown): void;
}

/** Control characters as they arrive in raw mode. */
const CTRL_C = "\x03";
const CTRL_D = "\x04";
const CTRL_R = "\x12";

/** An action a key can trigger. */
export type SessionKey = "reload" | "rebuild" | "open" | "clear" | "help" | "quit";

/**
 * Maps a key to its action: `r` reload, Ctrl+R rebuild, `o` open DevTools, `c` clear, `h`/`?` help, and
 * `q`, Ctrl+C or Ctrl+D quit.
 */
export function keyToAction(key: string): SessionKey | null {
  switch (key) {
    case "r":
    case "R":
      return "reload";
    case CTRL_R:
      return "rebuild";
    case "o":
    case "O":
      return "open";
    case "c":
    case "C":
      return "clear";
    case "h":
    case "H":
    case "?":
      return "help";
    case "q":
    case "Q":
    case CTRL_C:
    case CTRL_D:
      return "quit";
    default:
      return null;
  }
}

/** Turns key presses into actions. A reload or rebuild that is already running is not started twice. */
export function createKeyHandler(actions: SessionActions): (key: string) => Promise<void> {
  let rebuilding = false;
  let reloading = false;

  return async (key) => {
    const action = keyToAction(key);
    switch (action) {
      case "reload":
        if (reloading) return;
        reloading = true;
        try {
          await actions.reload();
        } catch (error) {
          actions.reportError("reload", error);
        } finally {
          reloading = false;
        }
        return;
      case "rebuild":
        if (rebuilding) {
          writeLine(chalk.dim("A rebuild is already running — it will relaunch the app when it's done."));
          return;
        }
        rebuilding = true;
        try {
          await actions.rebuild();
        } catch (error) {
          actions.reportError("rebuild", error);
        } finally {
          rebuilding = false;
        }
        return;
      case "open":
        await actions.openDevtools();
        return;
      case "clear":
        actions.clear();
        return;
      case "help":
        actions.help();
        return;
      case "quit":
        await actions.quit();
        return;
      default:
        return;
    }
  };
}

/** Splits input into single keys. Escape sequences (arrow keys and the like) are ignored. */
export function splitKeys(chunk: string): string[] {
  if (chunk.startsWith("\x1b")) return [];
  return [...chunk];
}

/** The parts of `process.stdin` the session uses. Tests pass a fake. */
export interface KeyInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  removeListener(event: "data", listener: (chunk: string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

/**
 * Starts reading shortcuts from `input`. Does nothing when `input` is not a terminal.
 *
 * @returns A function that stops reading and restores the terminal. It also runs when the process exits.
 */
export function startKeySession(actions: SessionActions, input: KeyInput = process.stdin): () => void {
  if (!input.isTTY || !input.setRawMode) return () => {};

  const handle = createKeyHandler(actions);
  let stopped = false;
  const onData = (chunk: string) => {
    for (const key of splitKeys(chunk)) void handle(key);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    input.removeListener("data", onData);
    input.setRawMode?.(false);
    input.pause();
    process.removeListener("exit", stop);
  };

  input.setRawMode(true);
  input.setEncoding("utf8");
  input.on("data", onData);
  input.resume();
  process.on("exit", stop);
  return stop;
}
