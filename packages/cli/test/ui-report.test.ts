import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configureUi, setTerminalStreams, stripAnsi } from "../src/ui/terminal.js";
import {
  debugRetryCommand,
  printBuildSummary,
  printFailure,
  printRunSummary,
  shortcutsLine,
} from "../src/ui/report.js";
import { ProcessFailure } from "../src/process/run-process.js";
import { closeRunLog, openRunLog } from "../src/process/run-log.js";

let out: string;
let err: string;
let dir: string;

beforeEach(() => {
  out = "";
  err = "";
  setTerminalStreams({ out: (c) => (out += c), err: (c) => (err += c), columns: () => 120 });
  configureUi({ debug: false, interactive: false, unicode: true });
  dir = mkdtempSync(join(tmpdir(), "wefter-report-"));
});

afterEach(() => {
  closeRunLog();
  setTerminalStreams(null);
  rmSync(dir, { recursive: true, force: true });
});

const gradleFailure = () =>
  new ProcessFailure("Gradle build failed with exit code 1", "Gradle", 1, {
    errors: ["ScannerPlugin.kt:41:17 Unresolved reference 'barcodeOptions'."],
    hints: ["The generated plugin registry is out of date. Run `wefter sync` and try again."],
  });

describe("printFailure", () => {
  it("shows the headline, the real errors, the fixes, the log and the --debug command", () => {
    openRunLog(dir, "run-android");
    printFailure("Couldn't run the Android app", gradleFailure(), "wefter run android --watch --debug");

    const text = stripAnsi(err);
    expect(text).toContain("✖ Couldn't run the Android app — Gradle build failed with exit code 1");
    expect(text).toContain("  ScannerPlugin.kt:41:17 Unresolved reference 'barcodeOptions'.");
    expect(text).toContain("  › The generated plugin registry is out of date.");
    expect(text).toMatch(/Full log {2}.*\.wefter\/logs\/run-android-.*\.log/);
    expect(text).toContain("More      wefter run android --watch --debug");
    expect(out).toBe("");
  });

  it("prints a plain error's message, line by line", () => {
    printFailure("Android build failed", new Error("Release security check failed:\n  - debuggable is true"));
    const text = stripAnsi(err);
    expect(text).toContain("✖ Android build failed\n\n  Release security check failed:\n    - debuggable is true\n");
  });

  it("doesn't suggest --debug when already running with --debug", () => {
    configureUi({ debug: true });
    printFailure("Android build failed", gradleFailure(), "wefter build android --debug");
    expect(stripAnsi(err)).not.toContain("More");
  });
});

describe("printRunSummary", () => {
  it("shows where the app runs, the URLs and the shortcuts", () => {
    printRunSummary({
      appName: "Wefter Demo",
      targetName: "Pixel 8 (emulator-5554)",
      buildMs: 38_200,
      devServerUrl: "http://10.0.0.2:5173",
      devtoolsUrl: "http://10.0.0.2:5173/__wefter-devtools",
      shortcuts: true,
    });
    const text = stripAnsi(out);
    expect(text).toContain("✔ Wefter Demo is running on Pixel 8 (emulator-5554) · built in 38.2s");
    expect(text).toContain("Dev server  http://10.0.0.2:5173");
    expect(text).toContain("DevTools    http://10.0.0.2:5173/__wefter-devtools");
    expect(text).toContain(stripAnsi(shortcutsLine()));
  });

  it("leaves out URLs and shortcuts for a run without --watch", () => {
    printRunSummary({ appName: "Demo", targetName: "Pixel 8", buildMs: 1000, shortcuts: false });
    const text = stripAnsi(out);
    expect(text).not.toContain("Dev server");
    expect(text).not.toContain("reload app");
  });
});

describe("printBuildSummary", () => {
  it("shows the artifact, its size and the plugins", () => {
    printBuildSummary({
      appName: "Wefter Demo",
      platformLabel: "Android · debug · development",
      artifactPath: "/out/app-development-debug.apk",
      sizeLabel: "8.4 MB",
      plugins: ["app", "scanner"],
    });
    const text = stripAnsi(out);
    expect(text).toContain("✔ Built Wefter Demo (Android · debug · development)");
    expect(text).toContain("/out/app-development-debug.apk · 8.4 MB");
    expect(text).toContain("2 plugins: app, scanner");
  });
});

describe("shortcutsLine / debugRetryCommand", () => {
  it("lists every shortcut", () => {
    expect(stripAnsi(shortcutsLine())).toBe(
      "r reload app · Ctrl+R rebuild native · o open DevTools · c clear · h help · q quit",
    );
  });

  it("repeats the command with --debug", () => {
    expect(debugRetryCommand({ command: "run", platform: "android", flags: ["--watch", "--env", "staging"] })).toBe(
      "wefter run android --watch --env staging --debug",
    );
  });
});
