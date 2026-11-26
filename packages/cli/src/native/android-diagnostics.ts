/** Turns Gradle and adb output into a short list of errors and fix suggestions. */

import { basename } from "node:path";
import type { Diagnosis } from "../process/run-process.js";

/** Most error lines shown; the run log has the rest. */
const MAX_ERRORS = 15;

/** Adds a trimmed line unless it is empty, already listed or over the limit. */
function addUnique(list: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed && !list.includes(trimmed) && list.length < MAX_ERRORS) list.push(trimmed);
}

/** File name without its folder or `file://` prefix. */
function shortFile(path: string): string {
  return basename(path.replace(/^file:\/\//, ""));
}

/** Compiler and resource error formats: Kotlin (current and older style), Java and AAPT. */
const KOTLIN_ERROR = /^e:\s+(?:file:\/\/)?(\S+?\.kts?):(\d+):(\d+)\s+(.+)$/;
const KOTLIN_ERROR_LEGACY = /^e:\s+(\S+?\.kts?):\s*\((\d+),\s*(\d+)\):\s*(.+)$/;
const JAVA_ERROR = /^(\S+?\.java):(\d+):\s+error:\s+(.+)$/;
const AAPT_ERROR = /(?:^|\s)(?:ERROR:\s*)?(\S+?):(\d+):\s*AAPT:\s*error:\s*(.+)$/;
const AAPT_ERROR_BARE = /AAPT:\s*error:\s*(.+)$/;

/** The lines under Gradle's `* What went wrong:` heading. */
function whatWentWrong(lines: string[]): string[] {
  const out: string[] = [];
  const start = lines.findIndex((line) => line.trim() === "* What went wrong:");
  if (start === -1) return out;
  for (let i = start + 1; i < lines.length && out.length < 8; i++) {
    const line = lines[i]!;
    if (/^\* (Try|Get more help|Exception is):/.test(line.trim())) break;
    if (line.trim() === "" && out.length > 0) break;
    if (line.trim() !== "") out.push(line.trim().replace(/^> /, ""));
  }
  return out;
}

/**
 * Finds compile errors in Gradle output (falling back to Gradle's own summary) and adds hints for common
 * setup problems: missing SDK, wrong JDK, unaccepted licences, failed downloads, a stale plugin registry,
 * Gradle locks and running out of memory.
 */
export function diagnoseGradle(lines: string[]): Diagnosis {
  const errors: string[] = [];
  const hints: string[] = [];
  const text = lines.join("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    let m = KOTLIN_ERROR.exec(trimmed) ?? KOTLIN_ERROR_LEGACY.exec(trimmed);
    if (m) {
      addUnique(errors, `${shortFile(m[1]!)}:${m[2]}:${m[3]} ${m[4]}`);
      continue;
    }
    m = JAVA_ERROR.exec(trimmed);
    if (m) {
      addUnique(errors, `${shortFile(m[1]!)}:${m[2]} ${m[3]}`);
      continue;
    }
    m = AAPT_ERROR.exec(trimmed);
    if (m) {
      addUnique(errors, `${shortFile(m[1]!)}:${m[2]} ${m[3]}`);
      continue;
    }
    m = AAPT_ERROR_BARE.exec(trimmed);
    if (m) addUnique(errors, `AAPT: ${m[1]}`);
  }

  const summary = whatWentWrong(lines);
  if (errors.length === 0) for (const line of summary) addUnique(errors, line);

  if (/SDK location not found|ANDROID_(HOME|SDK_ROOT).*(not set|invalid)/i.test(text)) {
    hints.push(
      "Android SDK not found. Set ANDROID_HOME to your SDK folder (Android Studio › Settings › Android SDK shows the path).",
    );
  }
  if (
    /Unsupported class file major version|invalid source release|requires Java \d+|Java \d+ (?:or \w+ )?is required/i.test(
      text,
    )
  ) {
    const wanted = /requires Java (\d+)|Java (\d+) (?:or \w+ )?is required/i.exec(text)?.slice(1).find(Boolean) ?? "17";
    hints.push(`Gradle is running on an incompatible JDK. Point JAVA_HOME at JDK ${wanted} and run again.`);
  }
  if (/not accepted the license agreements|licen[cs]es? (?:for .* )?(have not been|are not) accepted/i.test(text)) {
    hints.push("Accept the Android SDK licences: sdkmanager --licenses");
  }
  if (
    /Could not resolve all (files|dependencies|artifacts)|Could not (GET|HEAD) 'https?:|Could not download/i.test(text)
  ) {
    hints.push("Gradle couldn't download dependencies. Check your internet connection or proxy, then run again.");
  }
  if (/GeneratedRegistry\.kt(?::\d+:\d+|: \(\d+, \d+\):) .*Unresolved reference/i.test(text)) {
    hints.push("The generated plugin registry is out of date. Run `wefter sync` and try again.");
  }
  if (
    /Could not open settings generic class cache|Timeout waiting to lock|is currently in use by another Gradle instance/i.test(
      text,
    )
  ) {
    hints.push(
      "Another Gradle build is holding a lock. Wait for it to finish, or stop daemons with `./gradlew --stop`.",
    );
  }
  if (/OutOfMemoryError|Java heap space|GC overhead limit exceeded|Metaspace/i.test(text)) {
    hints.push("Gradle ran out of memory. Raise org.gradle.jvmargs (e.g. -Xmx4g) in gradle.properties.");
  }

  return { errors, hints };
}

/** Device and app details used in adb hints. */
export interface AdbContext {
  serial?: string;
  appId?: string;
}

/** An `INSTALL_FAILED_*` or `INSTALL_PARSE_FAILED_*` code and its message. */
const INSTALL_FAILURE = /(INSTALL_(?:FAILED|PARSE_FAILED)_[A-Z_]+)(?::\s*(.*?))?\]?$/;

/** How to fix each install failure code. */
const INSTALL_HINTS: Record<string, (ctx: AdbContext) => string> = {
  INSTALL_FAILED_UPDATE_INCOMPATIBLE: (ctx) =>
    `The installed app was signed with a different key. Uninstall it first: adb${ctx.serial ? ` -s ${ctx.serial}` : ""} uninstall ${ctx.appId ?? "<appId>"}`,
  INSTALL_FAILED_VERSION_DOWNGRADE: (ctx) =>
    `A newer version is already installed. Uninstall it first: adb${ctx.serial ? ` -s ${ctx.serial}` : ""} uninstall ${ctx.appId ?? "<appId>"}`,
  INSTALL_FAILED_INSUFFICIENT_STORAGE: () => "The device is out of storage. Free some space and run again.",
  INSTALL_FAILED_OLDER_SDK: () => "The device's Android version is older than the app's minSdk.",
  INSTALL_FAILED_NO_MATCHING_ABIS: () =>
    "The app has no native libraries for this device's CPU (e.g. an x86 emulator with ARM-only libraries).",
  INSTALL_FAILED_USER_RESTRICTED: () =>
    "The device blocked the install. Enable “Install via USB” in Developer options (common on Xiaomi/MIUI) and accept the prompt on the device.",
  INSTALL_FAILED_TEST_ONLY: () => "Test-only APKs need `adb install -t`; rebuild the debug variant without testOnly.",
  INSTALL_FAILED_INVALID_APK: () => "The APK is damaged or incomplete. Rebuild with Ctrl+R (or run again).",
  INSTALL_PARSE_FAILED_NO_CERTIFICATES: () => "The APK isn't signed. Rebuild it; release builds need a signing config.",
};

/**
 * Finds install and launch errors in adb output and explains them, including offline, unauthorised or
 * disconnected devices and a missing launch activity.
 */
export function diagnoseAdb(lines: string[], context: AdbContext = {}): Diagnosis {
  const errors: string[] = [];
  const hints: string[] = [];
  const text = lines.join("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    const install = INSTALL_FAILURE.exec(trimmed);
    if (install) {
      addUnique(errors, install[2] ? `${install[1]}: ${install[2]}` : install[1]!);
      const hint = INSTALL_HINTS[install[1]!];
      if (hint && !hints.includes(hint(context))) hints.push(hint(context));
      continue;
    }
    if (/^(adb: )?error:|^Error:|^Exception occurred|^Failure \[/i.test(trimmed)) addUnique(errors, trimmed);
  }

  if (/device offline/i.test(text)) {
    hints.push("The device went offline. Reconnect the cable (or restart the emulator) and run again.");
  } else if (/unauthorized/i.test(text)) {
    hints.push("The device hasn't authorised this computer. Accept the “Allow USB debugging” prompt on the device.");
  } else if (/no devices\/emulators found|device '.*' not found|device not found/i.test(text)) {
    hints.push("The device is no longer connected. Reconnect it (check `adb devices`) and run again.");
  }
  if (/Activity class \{.*\} does not exist/i.test(text)) {
    hints.push(
      "The app's launcher activity wasn't found. The app id or namespace changed — run `wefter sync`, then run again.",
    );
  }

  return { errors, hints };
}
