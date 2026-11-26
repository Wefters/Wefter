import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withoutDevServerAndroid, withoutDevServerIos } from "../src/native/without-dev-server.js";

const DEV_URL = "http://192.168.1.20:5173";

const GRADLE_WITH_DEV_SERVER = `buildTypes {
    debug {
        buildConfigField("String", "DEV_SERVER_URL", "\\"${DEV_URL}\\"") // overridden per-run by the CLI
    }
}
`;

const BUILD_CONFIG_WITH_DEV_SERVER = `enum BuildConfig {
    #if DEBUG
    static let devServerURL = "${DEV_URL}" // WEFTER overridden per-run by the CLI
    #endif
}
`;

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function writeFixture(name: string, contents: string): string {
  dir = mkdtempSync(join(tmpdir(), "wefter-without-dev-server-"));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe("withoutDevServerAndroid", () => {
  it("builds with the dev server address cleared, then restores it", async () => {
    const path = writeFixture("build.gradle.kts", GRADLE_WITH_DEV_SERVER);

    const seenDuringBuild = await withoutDevServerAndroid(path, async () => readFileSync(path, "utf-8"));

    expect(seenDuringBuild).toContain(`"DEV_SERVER_URL", "\\"\\"")`);
    expect(seenDuringBuild).not.toContain(DEV_URL);
    expect(readFileSync(path, "utf-8")).toBe(GRADLE_WITH_DEV_SERVER);
  });

  it("restores the address when the build fails", async () => {
    const path = writeFixture("build.gradle.kts", GRADLE_WITH_DEV_SERVER);

    await expect(
      withoutDevServerAndroid(path, async () => {
        throw new Error("gradle failed");
      }),
    ).rejects.toThrow("gradle failed");

    expect(readFileSync(path, "utf-8")).toBe(GRADLE_WITH_DEV_SERVER);
  });

  it("still builds when the file is missing", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-without-dev-server-"));
    await expect(withoutDevServerAndroid(join(dir, "missing.gradle.kts"), async () => "built")).resolves.toBe("built");
  });
});

describe("withoutDevServerIos", () => {
  it("builds with the dev server address cleared, then restores it", async () => {
    const path = writeFixture("BuildConfig.swift", BUILD_CONFIG_WITH_DEV_SERVER);

    const seenDuringBuild = await withoutDevServerIos(path, async () => readFileSync(path, "utf-8"));

    expect(seenDuringBuild).toContain('static let devServerURL = "" // WEFTER overridden per-run by the CLI');
    expect(readFileSync(path, "utf-8")).toBe(BUILD_CONFIG_WITH_DEV_SERVER);
  });
});
