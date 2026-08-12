import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectLaunchBackgroundIos } from "../src/native/inject-launch-background-ios.js";

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
