import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const openUrlMock = vi.fn().mockResolvedValue(true);
vi.mock("../src/utils/open-url.js", () => ({ openUrl: (...args: unknown[]) => openUrlMock(...args) }));

const { attachRunSession } = await import("../src/commands/run-interactive.js");
const { configureUi, setTerminalStreams, stripAnsi } = await import("../src/ui/terminal.js");
const { ProcessFailure } = await import("../src/process/run-process.js");
import type { RunSession } from "../src/commands/run.js";
import type { KeyInput } from "../src/commands/run-session.js";

class FakeInput extends EventEmitter implements KeyInput {
  isTTY = true;
  raw = false;
  setRawMode(mode: boolean) {
    this.raw = mode;
  }
  setEncoding() {}
  resume() {}
  pause() {}
  press(key: string) {
    this.emit("data", key);
  }
}

function fakeSession(overrides: Partial<RunSession> = {}) {
  const exitListeners: ((code: number | null) => void)[] = [];
  const devServer = {
    url: "http://10.0.0.2:5173",
    devtoolsUrl: Promise.resolve("http://10.0.0.2:5173/__wefter-devtools"),
    process: new EventEmitter(),
    stop: vi.fn(),
    onExit: (listener: (code: number | null) => void) => exitListeners.push(listener),
  };
  const session: RunSession = {
    platform: "android",
    appName: "Wefter Demo",
    targetName: "Pixel 8 (emulator-5554)",
    devServer: devServer as unknown as RunSession["devServer"],
    devtoolsUrl: "http://10.0.0.2:5173/__wefter-devtools",
    buildMs: 38_000,
    rebuild: vi.fn().mockResolvedValue(undefined),
    restartApp: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { session, devServer, crash: (code: number) => exitListeners.forEach((l) => l(code)) };
}

/** Lets queued promise callbacks (the key handlers) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let out: string;
let input: FakeInput;
let exit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  out = "";
  setTerminalStreams({ out: (c) => (out += c), err: (c) => (out += c), columns: () => 160 });
  configureUi({ debug: false, interactive: true, unicode: true });
  input = new FakeInput();
  exit = vi.fn();
  openUrlMock.mockClear();
});

afterEach(() => {
  setTerminalStreams(null);
  vi.unstubAllGlobals();
});

const attach = (session: RunSession) =>
  attachRunSession(session, { retryWithDebug: "wefter run android --watch --debug", input, exit });

describe("attachRunSession", () => {
  it("prints the summary with the shortcuts and starts listening for keys", () => {
    const { session } = fakeSession();
    attach(session);

    const text = stripAnsi(out);
    expect(text).toContain("✔ Wefter Demo is running on Pixel 8 (emulator-5554) · built in 38.0s");
    expect(text).toContain("DevTools    http://10.0.0.2:5173/__wefter-devtools");
    expect(text).toContain("Ctrl+R rebuild native");
    expect(input.raw).toBe(true);
  });

  it("r reloads the web view through the dev server when the app is connected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ clients: 1 }) }));
    const { session } = fakeSession();
    attach(session);

    input.press("r");
    await settle();

    expect(session.restartApp).not.toHaveBeenCalled();
    expect(stripAnsi(out)).toMatch(/✔ Reloaded app {2}/);
  });

  it("r restarts the app natively when no web view is connected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ clients: 0 }) }));
    const { session } = fakeSession();
    attach(session);

    input.press("r");
    await settle();

    expect(session.restartApp).toHaveBeenCalledTimes(1);
    expect(stripAnsi(out)).toContain("✔ Restarted app (no web view was connected to reload)");
  });

  it("Ctrl+R rebuilds and reports how long it took", async () => {
    const { session } = fakeSession();
    attach(session);

    input.press("\x12");
    await settle();

    expect(session.rebuild).toHaveBeenCalledTimes(1);
    expect(stripAnsi(out)).toMatch(/Rebuilding native app…[\s\S]*✔ Rebuilt and relaunched in \d+\.\ds/);
  });

  it("explains a failed rebuild and keeps running", async () => {
    const failure = new ProcessFailure("Gradle build failed with exit code 1", "Gradle", 1, {
      errors: ["ScannerPlugin.kt:41:17 Unresolved reference 'x'."],
      hints: [],
    });
    const { session, devServer } = fakeSession({ rebuild: vi.fn().mockRejectedValue(failure) });
    attach(session);

    input.press("\x12");
    await settle();

    const text = stripAnsi(out);
    expect(text).toContain("✖ Rebuild failed — Gradle build failed with exit code 1");
    expect(text).toContain("ScannerPlugin.kt:41:17 Unresolved reference 'x'.");
    expect(text).toContain("wefter run android --watch --debug");
    expect(text).toContain("Still running.");
    expect(exit).not.toHaveBeenCalled();
    expect(devServer.stop).not.toHaveBeenCalled();
  });

  it("o opens the DevTools dashboard", async () => {
    const { session } = fakeSession();
    attach(session);

    input.press("o");
    await settle();

    expect(openUrlMock).toHaveBeenCalledWith("http://10.0.0.2:5173/__wefter-devtools");
  });

  it("o explains how to get DevTools when the project doesn't use it", async () => {
    const { session } = fakeSession({ devtoolsUrl: null });
    attach(session);

    input.press("o");
    await settle();

    expect(openUrlMock).not.toHaveBeenCalled();
    expect(stripAnsi(out)).toContain("add @wefterjs/devtools");
  });

  it("c clears the screen and shows the summary again", async () => {
    const { session } = fakeSession();
    attach(session);
    out = "";

    input.press("c");
    await settle();

    expect(out.startsWith("\x1b[2J\x1b[3J\x1b[H")).toBe(true);
    expect(stripAnsi(out)).toContain("is running on Pixel 8");
  });

  it("q stops the dev server, restores the terminal and exits cleanly", async () => {
    const { session, devServer } = fakeSession();
    attach(session);

    input.press("q");
    await settle();

    expect(devServer.stop).toHaveBeenCalledTimes(1);
    expect(input.raw).toBe(false);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits with an error when the dev server crashes", () => {
    const { session, crash } = fakeSession();
    attach(session);

    crash(1);

    expect(stripAnsi(out)).toContain("✖ The dev server stopped");
    expect(stripAnsi(out)).toContain("Vite exited unexpectedly (exit code 1)");
    expect(input.raw).toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("without a terminal, prints the old Ctrl+C hint and doesn't touch stdin", () => {
    configureUi({ interactive: false });
    const { session, devServer } = fakeSession();
    const stop = attach(session);

    expect(stripAnsi(out)).toContain("Press Ctrl+C to stop.");
    expect(stripAnsi(out)).not.toContain("Ctrl+R rebuild native");
    expect(input.raw).toBe(false);
    stop();
    expect(devServer.stop).toHaveBeenCalledTimes(1);
  });

  it("without --watch, only prints the summary", () => {
    const { session } = fakeSession({ devServer: null, devtoolsUrl: null });
    attach(session);

    expect(stripAnsi(out)).toContain("is running on Pixel 8");
    expect(stripAnsi(out)).not.toContain("Dev server");
    expect(input.raw).toBe(false);
  });
});
