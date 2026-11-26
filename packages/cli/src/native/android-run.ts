import { ProcessFailure, runProcess } from "../process/run-process.js";
import { diagnoseAdb, type AdbContext } from "./android-diagnostics.js";

export interface AndroidTarget {
  serial: string;
  appId: string;
  /** The app's Kotlin namespace; the launcher activity is `<namespace>.MainActivity`. */
  namespace: string;
}

function adb(target: Pick<AndroidTarget, "serial" | "appId">, args: string[]): Promise<string[]> {
  const context: AdbContext = { serial: target.serial, appId: target.appId };
  return runProcess("adb", ["-s", target.serial, ...args], {
    tool: "adb",
    diagnose: (lines) => diagnoseAdb(lines, context),
  });
}

/**
 * adb doesn't always report failure through its exit code: older adb versions (and some vendor
 * builds) print "Failure [INSTALL_FAILED_…]" and exit 0, and `am start` always exits 0 even when
 * the activity doesn't exist. Treat those outputs as failures too.
 */
function assertNoReportedFailure(target: AndroidTarget, args: string[], lines: string[], pattern: RegExp): void {
  if (!lines.some((line) => pattern.test(line.trim()))) return;
  const diagnosis = diagnoseAdb(lines, { serial: target.serial, appId: target.appId });
  throw new ProcessFailure(
    `adb ${["-s", target.serial, ...args].join(" ")} reported a failure`,
    "adb",
    0,
    diagnosis.errors.length ? diagnosis : { ...diagnosis, errors: lines.filter((l) => pattern.test(l.trim())) },
  );
}

export async function installAndroidApp(target: AndroidTarget, apkPath: string): Promise<void> {
  const args = ["install", "-r", apkPath];
  const lines = await adb(target, args);
  assertNoReportedFailure(target, args, lines, /^Failure \[|INSTALL_(FAILED|PARSE_FAILED)_/);
}

export async function launchAndroidApp(target: AndroidTarget): Promise<void> {
  const args = ["shell", "am", "start", "-n", `${target.appId}/${target.namespace}.MainActivity`];
  const lines = await adb(target, args);
  assertNoReportedFailure(target, args, lines, /^Error( type \d+)?:|^Exception occurred/);
}

/** Force-stops and relaunches the app (the `r` fallback when no web view is connected to reload). */
export async function restartAndroidApp(target: AndroidTarget): Promise<void> {
  await adb(target, ["shell", "am", "force-stop", target.appId]);
  await launchAndroidApp(target);
}
