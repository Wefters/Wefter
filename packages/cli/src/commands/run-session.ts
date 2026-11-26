import chalk from "chalk";
import { writeLine } from "../ui/terminal.js";

/** What each shortcut does. The session only decides *when*; these decide *how*. */
export interface SessionActions {
  /** `r`: reload the app (web view reload, or a native restart as fallback). */
  reload(): Promise<void>;
  /** `Ctrl+R`: rebuild the native app, reinstall and relaunch it. */
  rebuild(): Promise<void>;
  /** `o`: open the DevTools dashboard. */
  openDevtools(): Promise<void> | void;
  /** `c`: clear the screen and show the summary again. */
  clear(): void;
  /** `h`: list the shortcuts. */
  help(): void;
  /** `q`, `Ctrl+C`, `Ctrl+D`: stop the dev server and exit. */
  quit(): Promise<void> | void;
  /** A reload/rebuild failed; report it and keep the session running. */
  reportError(action: "reload" | "rebuild", error: unknown): void;
}

const CTRL_C = "\x03";
const CTRL_D = "\x04";
const CTRL_R = "\x12";

export type SessionKey = "reload" | "rebuild" | "open" | "clear" | "help" | "quit";

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

/**
 * Turns key presses into actions. A rebuild can't start while one is running (extra Ctrl+R presses
 * are ignored with a note) and a failed reload/rebuild never ends the session — fix the code and
 * press the key again.
 */
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

/** Splits a raw-mode chunk into key presses; escape sequences (arrow keys, etc.) are ignored. */
export function splitKeys(chunk: string): string[] {
  if (chunk.startsWith("\x1b")) return [];
  return [...chunk];
}

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
 * Listens for single key presses on a terminal. Returns a `stop` function that restores the
 * terminal; it also runs automatically when the process exits, so a crash never leaves the
 * terminal in raw mode.
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
