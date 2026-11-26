import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { runProcess, ProcessFailure, tailLines } = await import("../src/process/run-process.js");
const { openRunLog, closeRunLog } = await import("../src/process/run-log.js");
const { configureUi, setTerminalStreams } = await import("../src/ui/terminal.js");

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

function fakeChild(opts: { stdout?: string[]; stderr?: string[]; code?: number | null; error?: Error }) {
  spawnMock.mockImplementationOnce(() => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (opts.error) {
        child.emit("error", opts.error);
        return;
      }
      for (const chunk of opts.stdout ?? []) child.stdout.emit("data", Buffer.from(chunk));
      for (const chunk of opts.stderr ?? []) child.stderr.emit("data", Buffer.from(chunk));
      child.emit("exit", opts.code ?? 0);
      child.emit("close", opts.code ?? 0);
    });
    return child;
  });
}

let printed: string;
let dir: string;

beforeEach(() => {
  printed = "";
  setTerminalStreams({ out: (c) => (printed += c), err: (c) => (printed += c), columns: () => 80 });
  configureUi({ debug: false, interactive: false });
  dir = mkdtempSync(join(tmpdir(), "wefter-runprocess-"));
});

afterEach(() => {
  setTerminalStreams(null);
  closeRunLog();
  spawnMock.mockReset();
  rmSync(dir, { recursive: true, force: true });
});

describe("runProcess", () => {
  it("captures output quietly, line by line, even when chunks split lines", async () => {
    fakeChild({ stdout: ["> Task :app:pre", "Build\n> Task :app:compile", "DebugKotlin\n"], stderr: ["w: warn\n"] });
    const onLine = vi.fn();

    const lines = await runProcess("./gradlew", ["assembleDebug"], { tool: "Gradle", onLine });

    expect(lines).toEqual(["> Task :app:preBuild", "> Task :app:compileDebugKotlin", "w: warn"]);
    expect(onLine.mock.calls.map(([line]) => line)).toEqual(lines);
    expect(printed).toBe("");
  });

  it("spawns with piped output and no stdin, passing cwd and env", async () => {
    fakeChild({});
    await runProcess("adb", ["devices"], { tool: "adb", cwd: "/project", env: { A: "1" } });
    expect(spawnMock).toHaveBeenCalledWith("adb", ["devices"], {
      cwd: "/project",
      env: { A: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("prints the command and every line live in --debug instead of calling onLine", async () => {
    configureUi({ debug: true });
    fakeChild({ stdout: ["BUILD SUCCESSFUL\n"] });
    const onLine = vi.fn();

    await runProcess("./gradlew", ["assembleDebug", "--console=plain"], { tool: "Gradle", onLine });

    expect(printed).toContain("[debug] $ ./gradlew assembleDebug --console=plain");
    expect(printed).toContain("BUILD SUCCESSFUL\n");
    expect(onLine).not.toHaveBeenCalled();
  });

  it("rejects with a ProcessFailure carrying the diagnosis on a non-zero exit", async () => {
    fakeChild({ stdout: ["e: Foo.kt:1:1 Broken\n"], code: 1 });

    const error = await runProcess("./gradlew", ["assembleDebug"], {
      tool: "Gradle",
      diagnose: () => ({ errors: ["Foo.kt:1:1 Broken"], hints: ["fix it"] }),
      failureMessage: (code) => `Gradle build failed with exit code ${code}`,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProcessFailure);
    expect(error).toMatchObject({
      message: "Gradle build failed with exit code 1",
      tool: "Gradle",
      exitCode: 1,
      diagnosis: { errors: ["Foo.kt:1:1 Broken"], hints: ["fix it"] },
    });
  });

  it("falls back to the last lines of output when nothing was recognised", async () => {
    const output = Array.from({ length: 30 }, (_, i) => `line ${i}\n`);
    fakeChild({ stdout: output, code: 2 });

    const error = (await runProcess("tool", [], { tool: "Tool", diagnose: () => ({ errors: [], hints: [] }) }).catch(
      (e: unknown) => e,
    )) as InstanceType<typeof ProcessFailure>;

    expect(error.message).toBe("tool failed with exit code 2");
    expect(error.diagnosis.errors).toHaveLength(20);
    expect(error.diagnosis.errors.at(-1)).toBe("line 29");
  });

  it("explains a tool that isn't installed", async () => {
    fakeChild({ error: Object.assign(new Error("spawn adb ENOENT"), { code: "ENOENT" }) });

    const error = (await runProcess("adb", ["devices"], { tool: "adb" }).catch((e: unknown) => e)) as InstanceType<
      typeof ProcessFailure
    >;

    expect(error.message).toMatch(/adb could not be started/);
    expect(error.diagnosis.hints).toEqual(["`adb` was not found. Is it installed and on your PATH?"]);
  });

  it("finishes on 'exit' for children without piped streams", async () => {
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 0));
      return child;
    });
    await expect(runProcess("xcrun", ["simctl", "boot", "X"], { tool: "Simulator" })).resolves.toEqual([]);
  });

  it("writes the command, its output and its exit status to the run log", async () => {
    const log = openRunLog(dir, "run-android")!;
    fakeChild({ stdout: ["Performing Streamed Install\n", "Success\n"] });

    await runProcess("adb", ["-s", "emulator-5554", "install", "-r", "/out/my app.apk"], { tool: "adb" });

    const text = readFileSync(log.path, "utf8");
    expect(text).toContain('$ adb -s emulator-5554 install -r "/out/my app.apk"');
    expect(text).toContain("Performing Streamed Install\nSuccess\n");
    expect(text).toMatch(/\[exit 0 after \d+\.\ds\]/);
  });
});

describe("tailLines", () => {
  it("drops blank lines and keeps the last N", () => {
    expect(tailLines(["a", "", "b", "  ", "c"], 2)).toEqual(["b", "c"]);
  });
});
