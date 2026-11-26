import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  injectLaunchBackgroundBuildConfigIos,
  injectLaunchBackgroundIos,
} from "../src/native/inject-launch-background-ios.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function storyboardWith(colorTag: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<document>\n<view>\n${colorTag}\n</view>\n</document>\n`;
}

describe("injectLaunchBackgroundIos", () => {
  it("rewrites the backgroundColor color element to the given hex color", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-launchbg-ios-"));
    const storyboardPath = join(dir, "LaunchScreen.storyboard");
    writeFileSync(
      storyboardPath,
      storyboardWith(
        '<color key="backgroundColor" red="1" green="1" blue="1" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>',
      ),
    );

    injectLaunchBackgroundIos(storyboardPath, "#000000");

    const result = readFileSync(storyboardPath, "utf-8");
    expect(result).toContain('<color key="backgroundColor" red="0" green="0" blue="0" alpha="1"');
  });

  it("converts a hex color to the correct 0-1 float components", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-launchbg-ios-"));
    const storyboardPath = join(dir, "LaunchScreen.storyboard");
    writeFileSync(
      storyboardPath,
      storyboardWith(
        '<color key="backgroundColor" red="1" green="1" blue="1" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>',
      ),
    );

    injectLaunchBackgroundIos(storyboardPath, "#FF0000");

    const result = readFileSync(storyboardPath, "utf-8");
    expect(result).toContain('red="1"');
    expect(result).toContain('green="0"');
    expect(result).toContain('blue="0"');
  });

  it("preserves colorSpace and customColorSpace attributes", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-launchbg-ios-"));
    const storyboardPath = join(dir, "LaunchScreen.storyboard");
    writeFileSync(
      storyboardPath,
      storyboardWith(
        '<color key="backgroundColor" red="1" green="1" blue="1" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>',
      ),
    );

    injectLaunchBackgroundIos(storyboardPath, "#14161C");

    const result = readFileSync(storyboardPath, "utf-8");
    expect(result).toContain('colorSpace="custom" customColorSpace="sRGB"');
  });

  it("throws when the file has no backgroundColor color element", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-launchbg-ios-"));
    const storyboardPath = join(dir, "LaunchScreen.storyboard");
    writeFileSync(storyboardPath, storyboardWith(""));

    expect(() => injectLaunchBackgroundIos(storyboardPath, "#14161C")).toThrow(/No backgroundColor/);
  });
});

describe("injectLaunchBackgroundBuildConfigIos", () => {
  const template = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../shells/ios-template/WefterBridge/BuildConfig.swift"),
    "utf-8",
  );

  it("defaults to white in the template", () => {
    expect(template).toContain("static let launchBackground: (red: Double, green: Double, blue: Double) = (1, 1, 1)");
  });

  it("writes the colour between the markers and replaces it on the next sync", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-launchbg-buildconfig-"));
    const path = join(dir, "BuildConfig.swift");
    writeFileSync(path, template);

    injectLaunchBackgroundBuildConfigIos(path, "#111314");
    injectLaunchBackgroundBuildConfigIos(path, "#FF0000");

    const result = readFileSync(path, "utf-8");
    expect(result).toContain("= (1, 0, 0)");
    expect(result.match(/static let launchBackground/g)).toHaveLength(1);
  });

  it("adds the markers inside BuildConfig in projects that predate them", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-launchbg-buildconfig-"));
    const path = join(dir, "BuildConfig.swift");
    writeFileSync(path, "enum BuildConfig {\n    static let landscape = false\n}\n");

    injectLaunchBackgroundBuildConfigIos(path, "#111314");

    expect(readFileSync(path, "utf-8")).toBe(
      "enum BuildConfig {\n    static let landscape = false\n\n" +
        "    // WEFTER-LAUNCH-BACKGROUND-START\n" +
        "    static let launchBackground: (red: Double, green: Double, blue: Double) = (0.0667, 0.0745, 0.0784)\n" +
        "    // WEFTER-LAUNCH-BACKGROUND-END\n}\n",
    );
  });
});
