import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { add, resolvePackageInfo } from "../src/commands/add.js";
import * as npmRegistry from "../src/plugins/npm-registry.js";

let projectDir: string;
let localRepoDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  if (localRepoDir) rmSync(localRepoDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function setup(): void {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-add-proj-"));
  localRepoDir = mkdtempSync(join(tmpdir(), "wefter-add-plugin-"));

  writeFileSync(join(projectDir, "wefter.config.json"), JSON.stringify({ plugins: [] }));
  writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "my-app", dependencies: {} }));
}

describe("add command", () => {
  it("rejects an obviously invalid package name or non-existent path", async () => {
    setup();

    await expect(add(projectDir, "not a package name!!")).rejects.toThrow(/doesn't look like/);
  });

  it("rejects a non-existent local path", async () => {
    setup();

    await expect(add(projectDir, "./non-existent-plugin-path")).rejects.toThrow(/does not exist/);
  });

  it("rejects a local repo directory that lacks package.json and plugin.json", async () => {
    setup();

    await expect(add(projectDir, localRepoDir)).rejects.toThrow(/No package.json or plugin.json found/);
  });

  it("adds an npm package by resolving metadata and updating files", async () => {
    setup();

    vi.spyOn(npmRegistry, "fetchNpmPackageInfo").mockResolvedValue({
      name: "@wefterjs/camera",
      version: "1.2.3",
    });

    const result = await add(projectDir, "@wefterjs/camera");

    expect(result).toEqual({
      added: true,
      alreadyDeclared: false,
      issues: [],
      resolvedVersion: "1.2.3",
      installHint: "npm install @wefterjs/camera@1.2.3",
    });

    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual(["@wefterjs/camera"]);

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@wefterjs/camera"]).toBe("^1.2.3");
  });

  it("adds a local repository via direct folder path", async () => {
    setup();

    writeFileSync(
      join(localRepoDir, "package.json"),
      JSON.stringify({ name: "@wefterjs/network", version: "0.0.1" }),
    );

    const result = await add(projectDir, localRepoDir);

    expect(result.added).toBe(true);
    expect(result.resolvedVersion).toBe("0.0.1");

    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual(["@wefterjs/network"]);

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@wefterjs/network"]).toMatch(/^file:/);
  });

  it("adds a local repository via file: prefix specifier", async () => {
    setup();

    writeFileSync(
      join(localRepoDir, "package.json"),
      JSON.stringify({ name: "@wefterjs/clipboard", version: "0.1.0" }),
    );

    const result = await add(projectDir, `file:${localRepoDir}`);

    expect(result.added).toBe(true);
    expect(result.resolvedVersion).toBe("0.1.0");

    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual(["@wefterjs/clipboard"]);

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@wefterjs/clipboard"]).toMatch(/^file:/);
  });

  it("adds a local repository via link: prefix specifier", async () => {
    setup();

    writeFileSync(
      join(localRepoDir, "package.json"),
      JSON.stringify({ name: "@wefterjs/device", version: "0.2.0" }),
    );

    const result = await add(projectDir, `link:${localRepoDir}`);

    expect(result.added).toBe(true);
    expect(result.resolvedVersion).toBe("0.2.0");

    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual(["@wefterjs/device"]);

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@wefterjs/device"]).toMatch(/^link:/);
  });

  it("reads plugin.json if package.json is absent in local repo", async () => {
    setup();

    writeFileSync(
      join(localRepoDir, "plugin.json"),
      JSON.stringify({ name: "@wefterjs/screen", version: "0.0.5" }),
    );

    const result = await add(projectDir, localRepoDir);

    expect(result.added).toBe(true);
    expect(result.resolvedVersion).toBe("0.0.5");

    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual(["@wefterjs/screen"]);
  });

  it("is idempotent when adding an already declared plugin", async () => {
    setup();

    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({ plugins: ["@wefterjs/network"] }),
    );
    writeFileSync(
      join(localRepoDir, "package.json"),
      JSON.stringify({ name: "@wefterjs/network", version: "0.0.1" }),
    );

    const result = await add(projectDir, localRepoDir);

    expect(result).toEqual({
      added: false,
      alreadyDeclared: true,
      issues: [],
      resolvedVersion: "0.0.1",
      installHint: "",
    });
  });

  it("falls back to local node_modules when npm registry fetch fails for an unpublished plugin", async () => {
    setup();

    vi.spyOn(npmRegistry, "fetchNpmPackageInfo").mockRejectedValue(new Error("404 Not Found"));

    const pluginDir = join(projectDir, "node_modules", "@wefterjs/unpublished-plugin");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "package.json"),
      JSON.stringify({ name: "@wefterjs/unpublished-plugin", version: "0.0.1-local" }),
    );

    const result = await add(projectDir, "@wefterjs/unpublished-plugin");

    expect(result.added).toBe(true);
    expect(result.resolvedVersion).toBe("0.0.1-local");

    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config.plugins).toEqual(["@wefterjs/unpublished-plugin"]);
  });
});
