import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apkFileName, nameBuiltApk } from "../src/native/android-builder.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("apkFileName", () => {
  it("names the APK after the app, environment and build type", () => {
    expect(apkFileName("Wefter Demo", "production", true)).toBe("Wefter-Demo-production-release.apk");
    expect(apkFileName("Wefter Demo", "development", false)).toBe("Wefter-Demo-development-debug.apk");
  });

  it("drops characters that do not belong in a file name", () => {
    expect(apkFileName("  Café / Shop!  ", "production", true)).toBe("Caf-Shop-production-release.apk");
    expect(apkFileName("???", "production", true)).toBe("app-production-release.apk");
  });

  it("marks an unsigned APK", () => {
    expect(apkFileName("Shop", "production", true, true)).toBe("Shop-production-release-unsigned.apk");
  });
});

describe("nameBuiltApk", () => {
  it("renames Gradle's APK, replacing the one from an earlier build", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-apk-"));
    writeFileSync(join(dir, "Wefter-Demo-production-release.apk"), "old");
    writeFileSync(join(dir, "app-production-release.apk"), "new");

    const apkPath = nameBuiltApk(dir, "Wefter Demo", "production", true);

    expect(apkPath).toBe(join(dir, "Wefter-Demo-production-release.apk"));
    expect(readdirSync(dir).filter((f) => f.endsWith(".apk"))).toEqual(["Wefter-Demo-production-release.apk"]);
  });

  it("keeps the unsigned marker", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-apk-"));
    writeFileSync(join(dir, "app-production-release-unsigned.apk"), "");

    expect(nameBuiltApk(dir, "Shop", "production", true)).toBe(join(dir, "Shop-production-release-unsigned.apk"));
  });

  it("fails when Gradle wrote no APK", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-apk-"));
    writeFileSync(join(dir, "Shop-production-release.apk"), "stale");

    expect(() => nameBuiltApk(dir, "Shop", "production", true)).toThrow("No APK found");
    expect(existsSync(join(dir, "Shop-production-release.apk"))).toBe(true);
  });
});

describe("artifactFileName and gradleTasks", () => {
  it("puts the version and build number in release file names", async () => {
    const { artifactFileName } = await import("../src/native/android-builder.js");
    const naming = {
      appName: "Wefter Demo",
      env: "production",
      release: true,
      version: { version: "1.4.0", buildNumber: 42 },
    };

    expect(artifactFileName(naming, "aab")).toBe("Wefter-Demo-production-1.4.0-42-release.aab");
    expect(artifactFileName(naming, "apk", true)).toBe("Wefter-Demo-production-1.4.0-42-release-unsigned.apk");
  });

  it("runs assemble for an APK, bundle for an App Bundle, and both for both", async () => {
    const { gradleTasks } = await import("../src/native/android-builder.js");

    expect(gradleTasks("production", true, "apk")).toEqual(["assembleProductionRelease"]);
    expect(gradleTasks("production", true, "aab")).toEqual(["bundleProductionRelease"]);
    expect(gradleTasks("staging", false, "both")).toEqual(["assembleStagingDebug", "bundleStagingDebug"]);
  });

  it("renames Gradle's App Bundle", async () => {
    const { nameBuiltFile } = await import("../src/native/android-builder.js");
    dir = mkdtempSync(join(tmpdir(), "wefter-aab-name-"));
    writeFileSync(join(dir, "app-production-release.aab"), "aab");

    const path = nameBuiltFile(dir, "app-production-release", "aab", {
      appName: "Shop",
      env: "production",
      release: true,
      version: { version: "2.0.0", buildNumber: 3 },
    });

    expect(path).toBe(join(dir, "Shop-production-2.0.0-3-release.aab"));
    expect(existsSync(path)).toBe(true);
  });
});
