/**
 * Opens a link on a device through the operating system, the way tapping it in another app would: on an
 * Android device or emulator with adb, or on the booted iOS Simulator with `xcrun simctl`. Unlike the
 * dashboard's "Send to app", this also tests that the native shell registered the link.
 */

import { execFile } from "node:child_process";
import type { DeepLinkPlatform, OpenLinkResult } from "../shared/events.js";

/** Runs a command and reports its exit status and output; replaceable in tests. */
export type CommandRunner = (command: string, args: string[]) => Promise<OpenLinkResult>;

/** Longest URL accepted, well above any real deep link. */
const MAX_URL_LENGTH = 2048;

/**
 * Whether `url` is safe to hand to a device: it parses as a URL with a scheme and has no whitespace or
 * control characters.
 */
export function isOpenableUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_URL_LENGTH || /[\s\u0000-\u001f\u007f]/.test(url)) return false;
  try {
    return new URL(url).protocol.length > 1;
  } catch {
    return false;
  }
}

/** Quotes `value` for the POSIX shell `adb shell` runs its command line in. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command that opens `url` on `platform`. adb passes its command line to the device's shell, so the
 * URL is quoted for it (a `&` in the query would otherwise end the command).
 */
export function openLinkCommand(platform: DeepLinkPlatform, url: string): { command: string; args: string[] } {
  if (platform === "android") {
    return {
      command: "adb",
      args: ["shell", `am start -W -a android.intent.action.VIEW -d ${shellQuote(url)}`],
    };
  }
  return { command: "xcrun", args: ["simctl", "openurl", "booted", url] };
}

/** Runs a command with a time limit and collects its output. */
const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 15_000 }, (error, stdout, stderr) => {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        resolve({ ok: false, output: `${command} was not found on the PATH.` });
        return;
      }
      const output = [stdout, stderr]
        .map((text) => text.trim())
        .filter(Boolean)
        .join("\n");
      resolve({ ok: !error && !/^Error:/m.test(stdout), output: output || error?.message || "" });
    });
  });

/**
 * Opens `url` on `platform` and reports the outcome. adb's `am start` prints its own errors to stdout
 * and still exits with 0, so those count as failures too.
 */
export async function openLinkOnDevice(
  platform: DeepLinkPlatform,
  url: string,
  run: CommandRunner = runCommand,
): Promise<OpenLinkResult> {
  if (!isOpenableUrl(url)) return { ok: false, output: "Not a valid URL." };
  const { command, args } = openLinkCommand(platform, url);
  return run(command, args);
}
