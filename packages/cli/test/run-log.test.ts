import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activeRunLog, closeRunLog, openRunLog, pruneRunLogs, RUN_LOG_DIR } from "../src/process/run-log.js";
import { setTerminalStreams, writeLine } from "../src/ui/terminal.js";
import chalk from "chalk";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wefter-runlog-"));
  setTerminalStreams({ out: () => {}, err: () => {}, columns: () => 80 });
});

afterEach(() => {
  closeRunLog();
  setTerminalStreams(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("openRunLog", () => {
  it("creates .wefter/logs/<name>-<timestamp>.log with a header and makes it active", () => {
    const log = openRunLog(dir, "run-android", new Date("2026-11-25T17:52:10.123Z"))!;

    expect(log.path).toBe(join(dir, RUN_LOG_DIR, "run-android-2026-11-25T17-52-10.log"));
    expect(readFileSync(log.path, "utf8")).toMatch(/^wefter run-android — 2026-11-25T17:52:10\.123Z\nproject: /);
    expect(activeRunLog()).toBe(log);
  });

  it("copies every printed line into the log, without colours", () => {
    const log = openRunLog(dir, "build-ios")!;
    writeLine(chalk.green("✔ Built"));
    writeLine("two\nlines", "err");

    expect(readFileSync(log.path, "utf8")).toContain("✔ Built\ntwo\nlines\n");
  });

  it("stops copying once closed", () => {
    const log = openRunLog(dir, "build-ios")!;
    closeRunLog();
    writeLine("after close");

    expect(readFileSync(log.path, "utf8")).not.toContain("after close");
    expect(activeRunLog()).toBeNull();
  });

  it("returns null instead of throwing when the folder can't be created", () => {
    writeFileSync(join(dir, ".wefter"), "a file where the folder should be");
    expect(openRunLog(dir, "run-ios")).toBeNull();
  });
});

describe("pruneRunLogs", () => {
  it("keeps only the newest logs", () => {
    const logs = join(dir, "logs");
    mkdirSync(logs);
    for (let i = 0; i < 13; i++) {
      const path = join(logs, `run-android-${i}.log`);
      writeFileSync(path, "x");
      utimesSync(path, 1_000 + i, 1_000 + i);
    }
    writeFileSync(join(logs, "notes.txt"), "not a log");

    pruneRunLogs(logs, 10);

    const left = readdirSync(logs).sort();
    expect(left).toHaveLength(11);
    expect(left).toContain("notes.txt");
    expect(left).not.toContain("run-android-0.log");
    expect(left).not.toContain("run-android-2.log");
    expect(left).toContain("run-android-3.log");
  });
});
