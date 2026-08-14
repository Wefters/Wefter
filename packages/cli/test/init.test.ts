import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { init } from "../src/commands/init.js";

let projectDir: string;

afterEach(() => {
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

function setup(pkg: Record<string, unknown> = { name: "my-cool-app" }): void {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-init-"));
  writeFileSync(join(projectDir, "package.json"), JSON.stringify(pkg, null, 2));
}

const defaultsPrompt = async (_question: string, defaultValue: string) => defaultValue;

describe("init", () => {
  it("wraps an existing project: writes config, pins deps in package.json, writes .env", async () => {
    setup();

    const result = await init(projectDir, "1.2.3", defaultsPrompt);

    expect(result.appId).toBe("dev.local.my_cool_app");
    expect(result.appName).toBe("My Cool App");
    expect(result.webDir).toBe("dist");
    expect(result.packageManager).toBe("npm");

    const config = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    expect(config).toEqual({
      webDir: "dist",
      plugins: [],
      pluginsDir: "node_modules",
      pluginConfig: {},
      environments: { development: { appId: "dev.local.my_cool_app", appName: "My Cool App" } },
    });

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@wefterjs/core"]).toBe("1.2.3");
    expect(pkg.devDependencies["@wefterjs/cli"]).toBe("1.2.3");

    const env = readFileSync(join(projectDir, ".env"), "utf-8");
    expect(env).toContain("WEFTER_APP_ID=dev.local.my_cool_app");
    expect(env).toContain("WEFTER_APP_NAME=My Cool App");
    expect(env).toContain("WEFTER_WEB_DIR=dist");
  });

  it("sets different versions for @wefterjs/core and @wefterjs/cli when specified", async () => {
    setup();

    await init(projectDir, { coreVersion: "0.0.1", cliVersion: "0.0.2" }, defaultsPrompt);

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@wefterjs/core"]).toBe("0.0.1");
    expect(pkg.devDependencies["@wefterjs/cli"]).toBe("0.0.2");
  });

  it("defaults to hardcoded package versions when version argument is omitted", async () => {
    setup();

    await init(projectDir, undefined, defaultsPrompt);

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@wefterjs/core"]).toBeDefined();
    expect(pkg.devDependencies["@wefterjs/cli"]).toBeDefined();
  });

  it("detects the package manager from the sole lockfile present", async () => {
    setup();
    writeFileSync(join(projectDir, "pnpm-lock.yaml"), "");

    const result = await init(projectDir, "1.0.0", defaultsPrompt);

    expect(result.packageManager).toBe("pnpm");
  });

  it("refuses multiple lockfiles rather than guessing", async () => {
    setup();
    writeFileSync(join(projectDir, "pnpm-lock.yaml"), "");
    writeFileSync(join(projectDir, "yarn.lock"), "");

    await expect(init(projectDir, "1.0.0", defaultsPrompt)).rejects.toThrow(/Multiple lockfiles/);
    expect(existsSync(join(projectDir, "wefter.config.json"))).toBe(false);
  });

  it("appends .wefter/ to an existing .gitignore", async () => {
    setup();
    writeFileSync(join(projectDir, ".gitignore"), "node_modules/\n");

    const result = await init(projectDir, "1.0.0", defaultsPrompt);

    expect(result.gitignoreUpdated).toBe(true);
    expect(readFileSync(join(projectDir, ".gitignore"), "utf-8")).toBe("node_modules/\n.wefter/\n");
  });

  it("does not touch .gitignore if none exists", async () => {
    setup();

    const result = await init(projectDir, "1.0.0", defaultsPrompt);

    expect(result.gitignoreUpdated).toBe(false);
    expect(existsSync(join(projectDir, ".gitignore"))).toBe(false);
  });

  it("refuses to run twice — wefter.config.json already exists", async () => {
    setup();
    writeFileSync(join(projectDir, "wefter.config.json"), "{}");

    await expect(init(projectDir, "1.0.0", defaultsPrompt)).rejects.toThrow(/already exists/);
  });

  it("refuses when there's no package.json to wrap", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "wefter-init-"));

    await expect(init(projectDir, "1.0.0", defaultsPrompt)).rejects.toThrow(/No package\.json found/);
  });

  it("refuses when @wefterjs/core or @wefterjs/cli is already declared", async () => {
    setup({ name: "app", dependencies: { "@wefterjs/core": "0.0.1" } });

    await expect(init(projectDir, "1.0.0", defaultsPrompt)).rejects.toThrow(/@wefterjs\/core.*already declared/);
    expect(existsSync(join(projectDir, "wefter.config.json"))).toBe(false);
  });

  it("refuses when .env already declares a WEFTER_* key, without overwriting it", async () => {
    setup();
    writeFileSync(join(projectDir, ".env"), "WEFTER_APP_ID=something.custom\n");

    await expect(init(projectDir, "1.0.0", defaultsPrompt)).rejects.toThrow(/WEFTER_APP_ID/);
    expect(readFileSync(join(projectDir, ".env"), "utf-8")).toBe("WEFTER_APP_ID=something.custom\n");
  });

  it("rejects an invalid appId before writing anything", async () => {
    setup();
    const badPrompt = async (question: string, defaultValue: string) =>
      question.startsWith("App ID") ? "Not An Id!" : defaultValue;

    await expect(init(projectDir, "1.0.0", badPrompt)).rejects.toThrow(/Invalid config/);
    expect(existsSync(join(projectDir, "wefter.config.json"))).toBe(false);
  });
});
