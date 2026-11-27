import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildOutputDir,
  collectArtifact,
  highestReleasedBuildNumber,
  resolveOutputRoot,
  writeBuildInfo,
} from "../src/app-build/artifacts.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("resolveOutputRoot", () => {
  it("uses --output over the config, relative to the project", () => {
    expect(resolveOutputRoot("/p", "build", "dist")).toBe("/p/build");
    expect(resolveOutputRoot("/p", "build", "dist", "out/apps")).toBe("/p/out/apps");
  });

  it("refuses the project itself, the web app's folder (either way round) and .wefter", () => {
    expect(() => resolveOutputRoot("/p", ".", "dist")).toThrow(/project folder/);
    expect(() => resolveOutputRoot("/p", "build", "build")).toThrow(/overlaps the web app/);
    expect(() => resolveOutputRoot("/p", "dist/native", "dist")).toThrow(/overlaps the web app/);
    expect(() => resolveOutputRoot("/p", "out", "out/web")).toThrow(/overlaps the web app/);
    expect(() => resolveOutputRoot("/p", ".wefter/out", "dist")).toThrow(/\.wefter/);
  });
});

describe("collectArtifact and writeBuildInfo", () => {
  it("copies a file with its checksum and lists it in build-info.json", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-artifacts-"));
    const source = join(dir, "gradle", "app.aab");
    mkdirSync(join(dir, "gradle"));
    writeFileSync(source, "bundle bytes");
    const outDir = buildOutputDir(join(dir, "build"), "android", "production", { version: "1.0.0", buildNumber: 3 });

    const artifact = await collectArtifact("aab", source, outDir, "Shop.aab");
    const { info } = writeBuildInfo(
      outDir,
      {
        app: { name: "Shop", id: "com.example.shop" },
        platform: "android",
        environment: "production",
        release: true,
        version: "1.0.0",
        buildNumber: 3,
        signed: true,
        git: { commit: null, dirty: null },
      },
      [artifact],
    );

    expect(outDir).toBe(join(dir, "build/android/production/1.0.0-3"));
    expect(artifact.sha256).toBe(createHash("sha256").update("bundle bytes").digest("hex"));
    expect(readFileSync(artifact.path, "utf-8")).toBe("bundle bytes");
    expect(info.artifacts).toEqual([{ kind: "aab", file: "Shop.aab", sizeBytes: 12, sha256: artifact.sha256 }]);
  });

  it("copies a folder (a simulator .app) without a checksum", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-artifacts-"));
    mkdirSync(join(dir, "Shop.app"));
    writeFileSync(join(dir, "Shop.app", "Shop"), "binary");

    const artifact = await collectArtifact("app", join(dir, "Shop.app"), join(dir, "out"));

    expect(artifact).toMatchObject({ kind: "app", sizeBytes: 6, sha256: null });
  });
});

describe("highestReleasedBuildNumber", () => {
  it("finds the highest earlier release build number, ignoring debug builds and this build's folder", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-artifacts-"));
    const root = join(dir, "build");
    const write = (folder: string, info: object) => {
      mkdirSync(join(root, "android/production", folder), { recursive: true });
      writeFileSync(join(root, "android/production", folder, "build-info.json"), JSON.stringify(info));
    };
    write("1.0.0-4", { release: true, buildNumber: 4, version: "1.0.0" });
    write("1.1.0-9", { release: false, buildNumber: 9, version: "1.1.0" });
    write("1.1.0-6", { release: true, buildNumber: 6, version: "1.1.0" });

    expect(highestReleasedBuildNumber(root, "android", "production")).toEqual({ buildNumber: 6, version: "1.1.0" });
    expect(highestReleasedBuildNumber(root, "android", "production", join(root, "android/production/1.1.0-6"))).toEqual(
      {
        buildNumber: 4,
        version: "1.0.0",
      },
    );
    expect(highestReleasedBuildNumber(root, "ios", "production")).toBeNull();
  });
});

describe("outputFolderIgnored", () => {
  it("checks .gitignore for the output folder, with or without slashes", async () => {
    const { outputFolderIgnored } = await import("../src/app-build/artifacts.js");
    dir = mkdtempSync(join(tmpdir(), "wefter-artifacts-"));

    expect(outputFolderIgnored(dir, join(dir, "build"))).toBe(true);
    writeFileSync(join(dir, ".gitignore"), "node_modules\n# build output\n");
    expect(outputFolderIgnored(dir, join(dir, "build"))).toBe(false);
    writeFileSync(join(dir, ".gitignore"), "node_modules\n/build/\n");
    expect(outputFolderIgnored(dir, join(dir, "build"))).toBe(true);
    expect(outputFolderIgnored(dir, join(dir, "build", "apps"))).toBe(true);
    expect(outputFolderIgnored(dir, join(dir, "out"))).toBe(false);
  });
});
