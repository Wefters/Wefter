import { basename } from "node:path";
import type { Diagnosis } from "../process/run-process.js";

const MAX_ERRORS = 15;

function addUnique(list: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed && !list.includes(trimmed) && list.length < MAX_ERRORS) list.push(trimmed);
}

/** "file:///Users/me/app/src/main/Foo.kt" or "/Users/me/app/Foo.kt" → "Foo.kt" */
function shortFile(path: string): string {
  return basename(path.replace(/^file:\/\//, ""));
}

// Kotlin (K2): "e: file:///path/Foo.kt:41:17 Unresolved reference 'x'."
const KOTLIN_ERROR = /^e:\s+(?:file:\/\/)?(\S+?\.kts?):(\d+):(\d+)\s+(.+)$/;
// Kotlin (K1): "e: /path/Foo.kt: (41, 17): Unresolved reference: x"
const KOTLIN_ERROR_LEGACY = /^e:\s+(\S+?\.kts?):\s*\((\d+),\s*(\d+)\):\s*(.+)$/;
// javac: "/path/Foo.java:12: error: cannot find symbol"
const JAVA_ERROR = /^(\S+?\.java):(\d+):\s+error:\s+(.+)$/;
// AAPT2: "ERROR: /path/res/layout/main.xml:7: AAPT: error: attribute android:foo not found."
const AAPT_ERROR = /(?:^|\s)(?:ERROR:\s*)?(\S+?):(\d+):\s*AAPT:\s*error:\s*(.+)$/;
const AAPT_ERROR_BARE = /AAPT:\s*error:\s*(.+)$/;

/** Gradle's "* What went wrong:" block, up to the "* Try:" block (or the next section). */
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
 * Pulls the real errors out of a failed Gradle build and adds fixes for problems we recognise.
 * Compiler errors come first (they are what the developer has to fix); Gradle's own summary is
 * used when there are none (configuration, dependency and environment failures).
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
  // Only when the error is *in* the generated registry (it is compiled in every build).
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

export interface AdbContext {
  serial?: string;
  appId?: string;
}

const INSTALL_FAILURE = /(INSTALL_(?:FAILED|PARSE_FAILED)_[A-Z_]+)(?::\s*(.*?))?\]?$/;

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

/** Explains a failed `adb install` / `adb shell am start`, using the app and device when known. */
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
