/** Turns xcodebuild and simctl output into a short list of errors and fix suggestions. */

import { basename } from "node:path";
import type { Diagnosis } from "../process/run-process.js";

/** Most error lines shown; the run log has the rest. */
const MAX_ERRORS = 15;

/** Adds a trimmed line unless it is empty, already listed or over the limit. */
function addUnique(list: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed && !list.includes(trimmed) && list.length < MAX_ERRORS) list.push(trimmed);
}

/** `/path/File.swift:12:5: error: …` from the Swift and Clang compilers. */
const COMPILER_ERROR = /^(\/\S.*?):(\d+)(?::(\d+))?: (?:fatal )?error: (.+)$/;
/** `error: …` from xcodebuild and the tools it runs. */
const TOOL_ERROR = /^(?:(?:xcodebuild|ld|clang|swift-frontend|codesign|actool|ibtool):\s*)?error:\s*(.+)$/;
/** `<project>.xcodeproj: error: …`, how xcodebuild reports signing and project setting problems. */
const PROJECT_ERROR = /^\/\S.*?\.xcodeproj: error: (.+?)(?: \(in target '[^']*' from project '[^']*'\))?$/;
/** Heading of xcodebuild's list of failed build commands. */
const FAILED_COMMANDS_HEADER = /^The following build commands failed:/;

/**
 * Finds compiler and tool errors in xcodebuild output (falling back to the list of failed commands) and adds
 * hints for a stale plugin registry, a missing simulator, a misconfigured Xcode, signing, a locked build
 * folder, an unhealthy simulator service and missing platforms.
 */
export function diagnoseXcode(lines: string[]): Diagnosis {
  const errors: string[] = [];
  const hints: string[] = [];
  const text = lines.join("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    const compiler = COMPILER_ERROR.exec(trimmed);
    if (compiler) {
      const where = `${basename(compiler[1]!)}:${compiler[2]}${compiler[3] ? `:${compiler[3]}` : ""}`;
      addUnique(errors, `${where}: ${compiler[4]}`);
      continue;
    }
    const project = PROJECT_ERROR.exec(trimmed);
    if (project) {
      addUnique(errors, project[1]!);
      continue;
    }
    const tool = TOOL_ERROR.exec(trimmed);
    if (tool) addUnique(errors, tool[1]!);
  }

  if (errors.length === 0) {
    const start = lines.findIndex((line) => FAILED_COMMANDS_HEADER.test(line.trim()));
    if (start !== -1) {
      for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (line === "" || /^\(\d+ failures?\)$/.test(line)) break;
        addUnique(errors, line);
      }
    }
  }

  if (
    /GeneratedRegistry\.swift:\d+(?::\d+)?: (?:fatal )?error: (?:cannot find .* in scope|no such module)/i.test(text)
  ) {
    hints.push("The generated plugin registry is out of date. Run `wefter sync` and try again.");
  }
  if (/Unable to find a (destination|device) matching/i.test(text)) {
    hints.push(
      "That simulator isn't available. List simulators with `xcrun simctl list devices` and pass --simulator <name or UDID>.",
    );
  }
  if (/requires Xcode, but active developer directory/i.test(text)) {
    hints.push("Xcode's command-line tools point at the wrong place: sudo xcode-select -s /Applications/Xcode.app");
  }
  if (
    /No (signing certificate|profiles? for)|requires a development team|Code ?signing is required|No Account for Team/i.test(
      text,
    )
  ) {
    hints.push("Code signing failed. Check the iOS signing settings (team and profile) in wefter.config.json.");
  }
  if (/No profiles for '.*' were found|Automatic signing is disabled and unable to generate a profile/i.test(text)) {
    hints.push(
      'No provisioning profile for this app. Add an App Store Connect API key ("signing": { "ios": { "appStoreConnect": … } }) so Xcode can create one, ' +
        'name an installed profile in "provisioningProfile", or sign in to the team in Xcode › Settings › Accounts.',
    );
  }
  if (/database is locked|Unable to write to info file|unable to attach DB/i.test(text)) {
    hints.push("Another build is using the same build folder. Wait for it (or quit Xcode's build) and run again.");
  }
  if (/CoreSimulatorService|Unable to boot device|simdiskimaged/i.test(text)) {
    hints.push("The simulator service is unhealthy. Quit Simulator, run `xcrun simctl shutdown all`, and run again.");
  }
  if (/is not available because .* not installed|iOS \d+(\.\d+)? (?:Platform|SDK) (?:is )?not installed/i.test(text)) {
    hints.push("The iOS platform for this simulator isn't installed. Install it in Xcode › Settings › Components.");
  }

  return { errors, hints };
}

/**
 * Finds errors in simctl output and explains a shut-down or missing simulator, or an app that could not be
 * launched.
 */
export function diagnoseSimctl(lines: string[]): Diagnosis {
  const errors: string[] = [];
  const hints: string[] = [];
  const text = lines.join("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^An error was encountered processing the command/i.test(trimmed)) continue;
    if (/^(Underlying error|Failed|Unable|Invalid|The operation couldn’t|The request|.*error)/i.test(trimmed)) {
      addUnique(errors, trimmed);
    }
  }

  if (/Unable to lookup in current state: Shutdown|current state: Shutdown/i.test(text)) {
    hints.push("The simulator shut down during the run. Boot it again (open Simulator) and run again.");
  }
  if (/Invalid device/i.test(text)) {
    hints.push("The simulator no longer exists. Pick another with --simulator (see `xcrun simctl list devices`).");
  }
  if (/found nothing to terminate|application.*not installed|FBSOpenApplicationServiceErrorDomain/i.test(text)) {
    hints.push("The app couldn't be launched. Rebuild with Ctrl+R (or run again) so it's freshly installed.");
  }

  return { errors, hints };
}
