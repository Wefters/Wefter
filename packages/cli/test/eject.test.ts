import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { eject } from "../src/commands/eject.js";
import { isEjected } from "../src/config/project-paths.js";

const fixtureTestProjectDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/test-project");

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-eject-"));
  cpSync(join(fixtureTestProjectDir, "plugins"), join(projectDir, "plugins"), { recursive: true });
  cpSync(join(fixtureTestProjectDir, "wefter.config.json"), join(projectDir, "wefter.config.json"));
  cpSync(join(fixtureTestProjectDir, "web"), join(projectDir, "web"), { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("eject", () => {
  it("syncs, copies both native projects to android/ and ios/, and writes the eject marker", async () => {
    expect(isEjected(projectDir)).toBe(false);

    const dests = await eject(projectDir);

    expect(dests).toEqual([join(projectDir, "android"), join(projectDir, "ios")]);
    expect(existsSync(join(projectDir, "android/app/build.gradle.kts"))).toBe(true);
    expect(existsSync(join(projectDir, "android/app/src/main/java/com/example/app/GeneratedRegistry.kt"))).toBe(true);
    expect(existsSync(join(projectDir, "ios/WefterBridge.xcodeproj"))).toBe(true);
    expect(existsSync(join(projectDir, "ios/WefterBridge/GeneratedRegistry.swift"))).toBe(true);
    expect(isEjected(projectDir)).toBe(true);
    expect(readFileSync(join(projectDir, ".wefter-ejected"), "utf-8")).toContain("true");
  });

  it("throws when called a second time", async () => {
    await eject(projectDir);

    await expect(eject(projectDir)).rejects.toThrow(/Already ejected/);
  });
});
