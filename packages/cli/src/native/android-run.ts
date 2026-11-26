/** Installs, launches and restarts the app on an Android device with adb. */

import { ProcessFailure, runProcess } from "../process/run-process.js";
import { diagnoseAdb, type AdbContext } from "./android-diagnostics.js";

/** The device and the app on it. */
export interface AndroidTarget {
  serial: string;
  appId: string;
  namespace: string;
}

/** Runs an adb command against the target device. */
function adb(target: Pick<AndroidTarget, "serial" | "appId">, args: string[]): Promise<string[]> {
  const context: AdbContext = { serial: target.serial, appId: target.appId };
  return runProcess("adb", ["-s", target.serial, ...args], {
    tool: "adb",
    diagnose: (lines) => diagnoseAdb(lines, context),
  });
}

/** Throws when adb printed a failure but still exited with 0, which `install` and `am start` do. */
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

/** Installs or updates the APK on the device. */
export async function installAndroidApp(target: AndroidTarget, apkPath: string): Promise<void> {
  const args = ["install", "-r", apkPath];
  const lines = await adb(target, args);
  assertNoReportedFailure(target, args, lines, /^Failure \[|INSTALL_(FAILED|PARSE_FAILED)_/);
}

/** Starts the app's main activity. */
export async function launchAndroidApp(target: AndroidTarget): Promise<void> {
  const args = ["shell", "am", "start", "-n", `${target.appId}/${target.namespace}.MainActivity`];
  const lines = await adb(target, args);
  assertNoReportedFailure(target, args, lines, /^Error( type \d+)?:|^Exception occurred/);
}

/** Force-stops the app and starts it again. */
export async function restartAndroidApp(target: AndroidTarget): Promise<void> {
  await adb(target, ["shell", "am", "force-stop", target.appId]);
  await launchAndroidApp(target);
}
