import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

function fakeSpawn(exitCode: number | null, err?: Error) {
  spawnMock.mockImplementationOnce(() => {
    const emitter = new EventEmitter();
    queueMicrotask(() => {
      if (err) emitter.emit("error", err);
      else emitter.emit("exit", exitCode);
    });
    return emitter;
  });
}

let dir: string;

function writePackageJson(scripts: Record<string, string>) {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts }));
}

afterEach(() => {
  spawnMock.mockReset();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("runHook", () => {
  it("does nothing when no package.json exists", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
    const { runHook } = await import("../src/hooks/run-hook.js");

    await runHook(dir, "sync", "before");

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("does nothing when the matching script is not defined", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
    writePackageJson({ "wefter:sync:after": "echo hi" });
    const { runHook } = await import("../src/hooks/run-hook.js");

    await runHook(dir, "sync", "before");

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("runs the matching script and resolves on exit code 0", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
    writePackageJson({ "wefter:build:before": "npm test" });
    fakeSpawn(0);
    const { runHook } = await import("../src/hooks/run-hook.js");

    await expect(runHook(dir, "build", "before", { platform: "android", environment: "production" })).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("rejects with a message naming the hook and exit code on non-zero exit", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
    writePackageJson({ "wefter:build:before": "exit 1" });
    fakeSpawn(1);
    const { runHook } = await import("../src/hooks/run-hook.js");

    await expect(runHook(dir, "build", "before")).rejects.toThrow('Hook "wefter:build:before" exited with code 1');
  });

  it("rejects when the spawned process itself errors (e.g. package manager not found)", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
    writePackageJson({ "wefter:sync:before": "echo hi" });
    fakeSpawn(null, new Error("ENOENT"));
    const { runHook } = await import("../src/hooks/run-hook.js");

    await expect(runHook(dir, "sync", "before")).rejects.toThrow("ENOENT");
  });

  it("passes WEFTER_* context as environment variables to the spawned process", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
    writePackageJson({ "wefter:run:after": "echo hi" });
    fakeSpawn(0);
    const { runHook } = await import("../src/hooks/run-hook.js");

    await runHook(dir, "run", "after", { platform: "ios", environment: "development" });

    const [, , spawnOptions] = spawnMock.mock.calls[0];
    expect(spawnOptions.env).toMatchObject({
      WEFTER_COMMAND: "run",
      WEFTER_PHASE: "after",
      WEFTER_PLATFORM: "ios",
      WEFTER_ENV: "development",
      WEFTER_PROJECT_DIR: dir,
    });
  });

  it("defaults WEFTER_PLATFORM and WEFTER_ENV to empty strings when no context is given", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
    writePackageJson({ "wefter:sync:before": "echo hi" });
    fakeSpawn(0);
    const { runHook } = await import("../src/hooks/run-hook.js");

    await runHook(dir, "sync", "before");

    const [, , spawnOptions] = spawnMock.mock.calls[0];
    expect(spawnOptions.env.WEFTER_PLATFORM).toBe("");
    expect(spawnOptions.env.WEFTER_ENV).toBe("");
  });

  it("streams hook output live via stdio: inherit rather than buffering it", async () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
    writePackageJson({ "wefter:sync:before": "echo hi" });
    fakeSpawn(0);
    const { runHook } = await import("../src/hooks/run-hook.js");

    await runHook(dir, "sync", "before");

    const [, , spawnOptions] = spawnMock.mock.calls[0];
    expect(spawnOptions.stdio).toBe("inherit");
  });

  describe("package manager detection", () => {
    it("uses npm when no lockfile is present", async () => {
      dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
      writePackageJson({ "wefter:sync:before": "echo hi" });
      fakeSpawn(0);
      const { runHook } = await import("../src/hooks/run-hook.js");

      await runHook(dir, "sync", "before");

      expect(spawnMock.mock.calls[0][0]).toBe("npm");
    });

    it("uses pnpm when pnpm-lock.yaml is present", async () => {
      dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
      writePackageJson({ "wefter:sync:before": "echo hi" });
      writeFileSync(join(dir, "pnpm-lock.yaml"), "");
      fakeSpawn(0);
      const { runHook } = await import("../src/hooks/run-hook.js");

      await runHook(dir, "sync", "before");

      expect(spawnMock.mock.calls[0][0]).toBe("pnpm");
    });

    it("uses yarn when yarn.lock is present", async () => {
      dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
      writePackageJson({ "wefter:sync:before": "echo hi" });
      writeFileSync(join(dir, "yarn.lock"), "");
      fakeSpawn(0);
      const { runHook } = await import("../src/hooks/run-hook.js");

      await runHook(dir, "sync", "before");

      expect(spawnMock.mock.calls[0][0]).toBe("yarn");
    });

    it("passes 'run <hookName>' as the spawned arguments", async () => {
      dir = mkdtempSync(join(tmpdir(), "wefter-runhook-"));
      writePackageJson({ "wefter:build:after": "echo hi" });
      fakeSpawn(0);
      const { runHook } = await import("../src/hooks/run-hook.js");

      await runHook(dir, "build", "after");

      expect(spawnMock.mock.calls[0][1]).toEqual(["run", "wefter:build:after"]);
    });
  });
});
