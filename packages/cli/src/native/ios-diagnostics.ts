import { basename } from "node:path";
import type { Diagnosis } from "../process/run-process.js";

const MAX_ERRORS = 15;

function addUnique(list: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed && !list.includes(trimmed) && list.length < MAX_ERRORS) list.push(trimmed);
}

// "/path/ViewController.swift:12:5: error: cannot find 'x' in scope"
const COMPILER_ERROR = /^(\/\S.*?):(\d+)(?::(\d+))?: (?:fatal )?error: (.+)$/;
// "error: …", "xcodebuild: error: …", "ld: error: …", "clang: error: …"
const TOOL_ERROR = /^(?:(?:xcodebuild|ld|clang|swift-frontend|codesign|actool|ibtool):\s*)?error:\s*(.+)$/;
// The lines xcodebuild lists under "The following build commands failed:"
const FAILED_COMMANDS_HEADER = /^The following build commands failed:/;

/**
 * Pulls the real errors out of a failed `xcodebuild` run (compiler errors first, then tool errors,
 * then the "build commands failed" list) and adds fixes for problems we recognise.
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

  // Only when the error is *in* the generated registry: it is compiled in every build, so its name
  // alone appearing in the log means nothing.
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

/** Explains a failed `xcrun simctl` install / launch / boot. */
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
