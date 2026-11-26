import { describe, expect, it } from "vitest";
import { diagnoseSimctl, diagnoseXcode } from "../src/native/ios-diagnostics.js";

const lines = (text: string) => text.split("\n");

describe("diagnoseXcode", () => {
  it("extracts Swift compiler errors with file:line:col and de-duplicates them", () => {
    const output = `SwiftCompile normal arm64 /Users/me/ios/WefterBridge/GeneratedRegistry.swift
/Users/me/ios/WefterBridge/GeneratedRegistry.swift:12:9: error: cannot find 'WefterBridge' in scope
        WefterBridge.register(ScannerPlugin())
        ^~~~~~~~~~~~
/Users/me/ios/WefterBridge/GeneratedRegistry.swift:12:9: error: cannot find 'WefterBridge' in scope
/Users/me/ios/WefterBridge/ViewController.swift:40: error: expected expression

** BUILD FAILED **`;
    const { errors, hints } = diagnoseXcode(lines(output));
    expect(errors).toEqual([
      "GeneratedRegistry.swift:12:9: cannot find 'WefterBridge' in scope",
      "ViewController.swift:40: expected expression",
    ]);
    expect(hints).toContain("The generated plugin registry is out of date. Run `wefter sync` and try again.");
  });

  it("doesn't blame the registry for an error in another file (the registry is compiled every build)", () => {
    const { hints } = diagnoseXcode(
      lines(`SwiftCompile normal arm64 Compiling\\ GeneratedRegistry.swift /Users/me/ios/WefterBridge/GeneratedRegistry.swift
/Users/me/ios/WefterBridge/Plugins/MyPlugin.swift:2:26: error: cannot find 'undefinedThing' in scope`),
    );
    expect(hints).toEqual([]);
  });

  it("extracts tool errors (xcodebuild, ld)", () => {
    const { errors } = diagnoseXcode(
      lines(`xcodebuild: error: Unable to find a destination matching the provided destination specifier:
ld: error: framework 'Foo' not found`),
    );
    expect(errors).toEqual([
      "Unable to find a destination matching the provided destination specifier:",
      "framework 'Foo' not found",
    ]);
  });

  it("falls back to the 'build commands failed' list when there are no error lines", () => {
    const { errors } = diagnoseXcode(
      lines(`The following build commands failed:
	PhaseScriptExecution Copy\\ web\\ assets /build/Script-1.sh (in target 'WefterBridge')
	CodeSign /build/App.app (in target 'WefterBridge')
(2 failures)`),
    );
    expect(errors).toEqual([
      "PhaseScriptExecution Copy\\ web\\ assets /build/Script-1.sh (in target 'WefterBridge')",
      "CodeSign /build/App.app (in target 'WefterBridge')",
    ]);
  });

  it.each([
    ["Unable to find a destination matching the provided destination specifier", /--simulator/],
    [
      "xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance",
      /xcode-select -s/,
    ],
    ['error: No signing certificate "iOS Development" found', /signing/],
    ["error: unable to attach DB: error: accessing build database: database is locked", /same build folder/],
    ["CoreSimulatorService connection became invalid", /simctl shutdown all/],
    ["iOS 26.0 Platform Not Installed", /Components/],
  ])("recognises %s", (text, hint) => {
    expect(diagnoseXcode([text]).hints.some((h) => hint.test(h))).toBe(true);
  });
});

describe("diagnoseSimctl", () => {
  it("keeps the meaningful lines of a simctl failure and explains a shut-down simulator", () => {
    const { errors, hints } = diagnoseSimctl(
      lines(`An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=405):
Unable to lookup in current state: Shutdown`),
    );
    expect(errors).toEqual(["Unable to lookup in current state: Shutdown"]);
    expect(hints[0]).toMatch(/shut down/);
  });

  it("explains a simulator that no longer exists", () => {
    expect(diagnoseSimctl(["Invalid device: AAA-1"]).hints[0]).toMatch(/--simulator/);
  });
});
