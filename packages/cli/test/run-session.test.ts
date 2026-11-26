import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  createKeyHandler,
  keyToAction,
  splitKeys,
  startKeySession,
  type KeyInput,
  type SessionActions,
} from "../src/commands/run-session.js";
import { setTerminalStreams, stripAnsi } from "../src/ui/terminal.js";

function actions(overrides: Partial<SessionActions> = {}): SessionActions {
  return {
    reload: vi.fn().mockResolvedValue(undefined),
    rebuild: vi.fn().mockResolvedValue(undefined),
    openDevtools: vi.fn(),
    clear: vi.fn(),
    help: vi.fn(),
    quit: vi.fn(),
    reportError: vi.fn(),
    ...overrides,
  };
}

let out: string;
beforeEach(() => {
  out = "";
  setTerminalStreams({ out: (c) => (out += c), err: (c) => (out += c), columns: () => 120 });
});
afterEach(() => setTerminalStreams(null));

describe("keyToAction", () => {
  it.each([
    ["r", "reload"],
    ["R", "reload"],
    ["\x12", "rebuild"],
    ["o", "open"],
    ["c", "clear"],
    ["h", "help"],
    ["?", "help"],
    ["q", "quit"],
    ["\x03", "quit"],
    ["\x04", "quit"],
    ["x", null],
    ["\r", null],
  ])("maps %j to %s", (key, action) => {
    expect(keyToAction(key)).toBe(action);
  });
});

describe("splitKeys", () => {
  it("splits typed characters and ignores escape sequences such as arrow keys", () => {
    expect(splitKeys("rq")).toEqual(["r", "q"]);
    expect(splitKeys("\x1b[A")).toEqual([]);
  });
});

describe("createKeyHandler", () => {
  it("runs the matching action", async () => {
    const a = actions();
    const handle = createKeyHandler(a);
    await handle("r");
    await handle("\x12");
    await handle("o");
    await handle("c");
    await handle("h");
    await handle("q");
    expect(a.reload).toHaveBeenCalledTimes(1);
    expect(a.rebuild).toHaveBeenCalledTimes(1);
    expect(a.openDevtools).toHaveBeenCalledTimes(1);
    expect(a.clear).toHaveBeenCalledTimes(1);
    expect(a.help).toHaveBeenCalledTimes(1);
    expect(a.quit).toHaveBeenCalledTimes(1);
  });

  it("ignores Ctrl+R while a rebuild is running, and allows it again afterwards", async () => {
    let finish!: () => void;
    const rebuild = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const handle = createKeyHandler(actions({ rebuild }));

    const first = handle("\x12");
    await handle("\x12");
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(stripAnsi(out)).toContain("A rebuild is already running");

    finish();
    await first;
    void handle("\x12");
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it("still reloads while a rebuild is running", async () => {
    const a = actions({ rebuild: vi.fn(() => new Promise<void>(() => {})) });
    const handle = createKeyHandler(a);
    void handle("\x12");
    await handle("r");
    expect(a.reload).toHaveBeenCalledTimes(1);
  });

  it("reports a failed rebuild and keeps the session going", async () => {
    const failure = new Error("Gradle build failed with exit code 1");
    const a = actions({ rebuild: vi.fn().mockRejectedValue(failure) });
    const handle = createKeyHandler(a);

    await handle("\x12");
    expect(a.reportError).toHaveBeenCalledWith("rebuild", failure);
    expect(a.quit).not.toHaveBeenCalled();

    await handle("\x12");
    expect(a.rebuild).toHaveBeenCalledTimes(2);
  });

  it("reports a failed reload", async () => {
    const failure = new Error("adb: error: device offline");
    const a = actions({ reload: vi.fn().mockRejectedValue(failure) });
    await createKeyHandler(a)("r");
    expect(a.reportError).toHaveBeenCalledWith("reload", failure);
  });
});

class FakeInput extends EventEmitter implements KeyInput {
  isTTY = true;
  raw = false;
  paused = true;
  encoding: string | null = null;
  setRawMode(mode: boolean) {
    this.raw = mode;
  }
  setEncoding(encoding: BufferEncoding) {
    this.encoding = encoding;
  }
  resume() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

describe("startKeySession", () => {
  it("puts the terminal in raw mode, dispatches key presses, and restores it on stop", async () => {
    const input = new FakeInput();
    const a = actions();
    const stop = startKeySession(a, input);

    expect(input.raw).toBe(true);
    expect(input.paused).toBe(false);
    expect(input.encoding).toBe("utf8");

    input.emit("data", "r");
    input.emit("data", "\x12");
    await Promise.resolve();
    expect(a.reload).toHaveBeenCalledTimes(1);
    expect(a.rebuild).toHaveBeenCalledTimes(1);

    stop();
    expect(input.raw).toBe(false);
    expect(input.paused).toBe(true);
    input.emit("data", "r");
    expect(a.reload).toHaveBeenCalledTimes(1);
  });

  it("restores the terminal when the process exits", () => {
    const input = new FakeInput();
    startKeySession(actions(), input);
    process.emit("exit", 0);
    expect(input.raw).toBe(false);
  });

  it("does nothing when input isn't a terminal", () => {
    const input = new FakeInput();
    input.isTTY = false;
    startKeySession(actions(), input);
    expect(input.raw).toBe(false);
    expect(input.listenerCount("data")).toBe(0);
  });
});
