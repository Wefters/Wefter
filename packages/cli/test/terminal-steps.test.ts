import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearScreen, configureUi, setStatus, setTerminalStreams, stripAnsi, writeLine } from "../src/ui/terminal.js";
import { formatElapsed, step } from "../src/ui/steps.js";

let out: string;
let err: string;

beforeEach(() => {
  out = "";
  err = "";
  setTerminalStreams({ out: (c) => (out += c), err: (c) => (err += c), columns: () => 40 });
  configureUi({ debug: false, interactive: false, unicode: true });
});

afterEach(() => {
  setStatus(null);
  setTerminalStreams(null);
  vi.useRealTimers();
});

describe("terminal output", () => {
  it("clears the status line before printing and redraws it after", () => {
    setStatus("⠋ Building");
    out = "";
    writeLine("[vite] page reload src/App.vue");

    expect(out).toBe("\r\x1b[2K[vite] page reload src/App.vue\n\r\x1b[2K⠋ Building");
  });

  it("clears the status line before writing to stderr too", () => {
    setStatus("⠋ Building");
    out = "";
    writeLine("warning", "err");

    expect(out).toBe("\r\x1b[2K\r\x1b[2K⠋ Building");
    expect(err).toBe("warning\n");
  });

  it("truncates the status line to the terminal width so it never wraps", () => {
    setStatus(`⠋ ${"x".repeat(100)}`);
    const visible = stripAnsi(out.split("\r\x1b[2K").at(-1)!);
    expect(visible.length).toBe(39);
    expect(visible.endsWith("…")).toBe(true);
  });

  it("removes the status line", () => {
    setStatus("⠋ Building");
    out = "";
    setStatus(null);
    expect(out).toBe("\r\x1b[2K");
  });

  it("clears the screen and scrollback", () => {
    clearScreen();
    expect(out).toBe("\x1b[2J\x1b[3J\x1b[H");
  });
});

describe("step — plain mode (CI, piped output, --debug)", () => {
  it("prints a start line and a ✔ line with the elapsed time", async () => {
    const result = await step("Building Android app (development)", async (s) => {
      s.detail("Compiling Kotlin");
      return 42;
    });

    expect(result).toBe(42);
    const lines = stripAnsi(out).trim().split("\n");
    expect(lines[0]).toBe("› Building Android app (development)…");
    expect(lines[1]).toMatch(/^✔ Building Android app \(development\) {2}\d+\.\ds$/);
  });

  it("uses a custom done label", async () => {
    await step("Starting dev server", async () => "http://10.0.0.2:5173", {
      done: (url) => `Dev server ready at ${url}`,
    });
    expect(stripAnsi(out)).toMatch(/✔ Dev server ready at http:\/\/10\.0\.0\.2:5173/);
  });

  it("prints ✖ and rethrows on failure", async () => {
    await expect(
      step("Installing on Pixel 8", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(stripAnsi(out)).toMatch(/✖ Installing on Pixel 8 {2}\d+\.\ds/);
  });

  it("uses ASCII symbols where Unicode isn't available", async () => {
    configureUi({ unicode: false });
    await step("Launching app", async () => undefined);
    expect(stripAnsi(out)).toContain("> Launching app…");
    expect(stripAnsi(out)).toMatch(/√ Launching app/);
  });
});

describe("step — spinner mode (interactive terminal)", () => {
  it("animates a spinner with live detail and replaces it with the result line", async () => {
    vi.useFakeTimers();
    configureUi({ interactive: true });
    setTerminalStreams({ out: (c) => (out += c), err: (c) => (err += c), columns: () => 100 });
    let finish!: () => void;

    const running = step("Building Android app", (s) => {
      s.detail("Compiling Kotlin");
      return new Promise<void>((resolve) => (finish = resolve));
    });
    vi.advanceTimersByTime(80 * 3);
    const frames = stripAnsi(out);
    expect(frames).toContain("⠋ Building Android app · Compiling Kotlin");
    expect(frames).toContain("⠸ Building Android app · Compiling Kotlin");

    finish();
    await running;

    const final = stripAnsi(out.slice(out.lastIndexOf("\r\x1b[2K") + 5));
    expect(final).toMatch(/^✔ Building Android app {2}\d+\.\ds\n$/);
  });

  it("does not animate in --debug, where tool output streams live", async () => {
    configureUi({ interactive: true, debug: true });
    await step("Building iOS app", async () => undefined);
    expect(stripAnsi(out)).toContain("› Building iOS app…");
  });
});

describe("formatElapsed", () => {
  it.each([
    [400, "0.4s"],
    [12_340, "12.3s"],
    [65_000, "1m 05s"],
    [119_600, "2m 00s"],
  ])("formats %dms as %s", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});
