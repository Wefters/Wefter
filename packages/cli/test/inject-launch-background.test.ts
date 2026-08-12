import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectLaunchBackgroundAndroid } from "../src/native/inject-launch-background.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function colorsXml(value: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="splashBackground">${value}</color>\n</resources>\n`;
}

describe("injectLaunchBackgroundAndroid", () => {
  it("overwrites the splashBackground color value", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-launchbg-android-"));
    const colorsPath = join(dir, "colors.xml");
    writeFileSync(colorsPath, colorsXml("#FFFFFF"));

    injectLaunchBackgroundAndroid(colorsPath, "#14161C");

    expect(readFileSync(colorsPath, "utf-8")).toContain('<color name="splashBackground">#14161C</color>');
  });

  it("leaves the rest of the file untouched", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-launchbg-android-"));
    const colorsPath = join(dir, "colors.xml");
    const original = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="somethingElse">#000000</color>\n    <color name="splashBackground">#FFFFFF</color>\n</resources>\n`;
    writeFileSync(colorsPath, original);

    injectLaunchBackgroundAndroid(colorsPath, "#0F766E");

    const result = readFileSync(colorsPath, "utf-8");
    expect(result).toContain('<color name="somethingElse">#000000</color>');
    expect(result).toContain('<color name="splashBackground">#0F766E</color>');
  });

  it("throws when the file has no splashBackground entry", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-launchbg-android-"));
    const colorsPath = join(dir, "colors.xml");
    writeFileSync(colorsPath, `<?xml version="1.0" encoding="utf-8"?>\n<resources></resources>\n`);

    expect(() => injectLaunchBackgroundAndroid(colorsPath, "#14161C")).toThrow(/No splashBackground/);
  });
});
