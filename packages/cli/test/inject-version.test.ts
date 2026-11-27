import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { injectVersionAndroid, injectVersionIos } from "../src/native/inject-version.js";

const shells = join(dirname(fileURLToPath(import.meta.url)), "../../../shells");
let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("injectVersionAndroid", () => {
  it("sets versionCode and versionName in the template's build.gradle.kts", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-version-android-"));
    const gradle = join(dir, "build.gradle.kts");
    cpSync(join(shells, "android-template/app/build.gradle.kts"), gradle);

    injectVersionAndroid(gradle, { version: "1.4.0", buildNumber: 42 });
    injectVersionAndroid(gradle, { version: "1.4.1", buildNumber: 43 });

    const contents = readFileSync(gradle, "utf-8");
    expect(contents).toMatch(/^\s+versionCode = 43$/m);
    expect(contents).toMatch(/^\s+versionName = "1\.4\.1"$/m);
  });

  it("fails clearly when the file has no version lines", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-version-android-"));
    const gradle = join(dir, "build.gradle.kts");
    writeFileSync(gradle, "android {}\n");
    expect(() => injectVersionAndroid(gradle, { version: "1.0.0", buildNumber: 1 })).toThrow(/versionCode/);
  });
});

describe("injectVersionIos", () => {
  it("writes the version into Shared.xcconfig, which the template's Info.plist reads", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-version-ios-"));
    const xcconfig = join(dir, "Shared.xcconfig");
    const plist = join(dir, "Info.plist");
    cpSync(join(shells, "ios-template/Config/Shared.xcconfig"), xcconfig);
    cpSync(join(shells, "ios-template/WefterBridge/Info.plist"), plist);

    injectVersionIos(xcconfig, plist, { version: "3.2.1", buildNumber: 7 });

    const contents = readFileSync(xcconfig, "utf-8");
    expect(contents).toContain("MARKETING_VERSION = 3.2.1");
    expect(contents).toContain("CURRENT_PROJECT_VERSION = 7");
    expect(contents.match(/WEFTER-VERSION-START/g)).toHaveLength(1);
    expect(readFileSync(plist, "utf-8")).toContain("<string>$(MARKETING_VERSION)</string>");
  });

  it("adds the version block, and makes an Info.plist with written-in numbers read it", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-version-ios-"));
    const xcconfig = join(dir, "Shared.xcconfig");
    const plist = join(dir, "Info.plist");
    writeFileSync(xcconfig, "SWIFT_VERSION = 5.0\n");
    writeFileSync(
      plist,
      "<dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>0.0.1</string>\n\t<key>CFBundleVersion</key>\n\t<string>1</string>\n</dict>\n",
    );

    injectVersionIos(xcconfig, plist, { version: "1.0.0", buildNumber: 2 });

    expect(readFileSync(xcconfig, "utf-8")).toContain(
      "SWIFT_VERSION = 5.0\n\n// WEFTER-VERSION-START\nMARKETING_VERSION = 1.0.0",
    );
    const updated = readFileSync(plist, "utf-8");
    expect(updated).toContain("<string>$(MARKETING_VERSION)</string>");
    expect(updated).toContain("<string>$(CURRENT_PROJECT_VERSION)</string>");
  });
});
