import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

let nextOutput = "";
let nextExitCode = 0;
let nextSpawnError: NodeJS.ErrnoException | null = null;

const spawnMock = vi.fn(() => {
  const emitter = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (nextSpawnError) {
      emitter.emit("error", nextSpawnError);
      return;
    }
    if (nextOutput) emitter.stdout.emit("data", Buffer.from(nextOutput));
    emitter.emit("exit", nextExitCode);
  });
  return emitter;
});
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const question = vi.fn();
const close = vi.fn();
vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(() => ({ question, close })),
}));

import { listAdbDevices, resolveAdbDevice } from "../src/native/adb-device.js";

describe("listAdbDevices", () => {
  beforeEach(() => {
    spawnMock.mockClear();
    nextOutput = "";
    nextExitCode = 0;
    nextSpawnError = null;
  });

  it("parses ready devices along with their state and model", async () => {
    nextOutput =
      "List of devices attached\n" +
      "emulator-5554\tdevice product:sdk_gphone model:Pixel_6 device:emulator64_x86_64\n" +
      "R58N90ABCDE\tunauthorized\n" +
      "\n";

    await expect(listAdbDevices()).resolves.toEqual([
      { serial: "emulator-5554", state: "device", model: "Pixel_6" },
      { serial: "R58N90ABCDE", state: "unauthorized", model: undefined },
    ]);
  });

  it("returns an empty list when nothing is connected", async () => {
    nextOutput = "List of devices attached\n\n";

    await expect(listAdbDevices()).resolves.toEqual([]);
  });

  it("throws a clear error when adb is not on PATH", async () => {
    const err = new Error("spawn adb ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    nextSpawnError = err;

    await expect(listAdbDevices()).rejects.toThrow(/adb not found on PATH/);
  });
});

describe("resolveAdbDevice", () => {
  const originalOverride = process.env.WEFTER_ADB_SERIAL;

  beforeEach(() => {
    spawnMock.mockClear();
    question.mockReset();
    close.mockReset();
    nextOutput = "";
    nextExitCode = 0;
    nextSpawnError = null;
    delete process.env.WEFTER_ADB_SERIAL;
  });

  afterEach(() => {
    if (originalOverride === undefined) delete process.env.WEFTER_ADB_SERIAL;
    else process.env.WEFTER_ADB_SERIAL = originalOverride;
  });

  it("fails fast when no device is connected", async () => {
    nextOutput = "List of devices attached\n\n";

    await expect(resolveAdbDevice()).rejects.toThrow(/No Android device\/emulator found/);
  });

  it("reports unauthorized/offline devices distinctly from 'none found'", async () => {
    nextOutput = "List of devices attached\nR58N90ABCDE\tunauthorized\n";

    await expect(resolveAdbDevice()).rejects.toThrow(/unauthorized/);
  });

  it("returns the only ready device directly, without prompting", async () => {
    nextOutput = "List of devices attached\nemulator-5554\tdevice\n";
    const prompt = vi.fn();

    await expect(resolveAdbDevice({ prompt })).resolves.toEqual({
      serial: "emulator-5554",
      state: "device",
      model: undefined,
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("delegates to the injected prompt when multiple ready devices are found", async () => {
    nextOutput =
      "List of devices attached\n" +
      "emulator-5554\tdevice model:Pixel_6\n" +
      "R58N90ABCDE\tdevice model:Galaxy_S21\n";
    const prompt = vi.fn().mockResolvedValue({ serial: "R58N90ABCDE", state: "device", model: "Galaxy_S21" });

    await expect(resolveAdbDevice({ isInteractive: true, prompt })).resolves.toEqual({
      serial: "R58N90ABCDE",
      state: "device",
      model: "Galaxy_S21",
    });
    expect(prompt).toHaveBeenCalledWith([
      { serial: "emulator-5554", state: "device", model: "Pixel_6" },
      { serial: "R58N90ABCDE", state: "device", model: "Galaxy_S21" },
    ]);
  });

  it("throws when multiple devices are found and there's no interactive terminal", async () => {
    nextOutput = "List of devices attached\nemulator-5554\tdevice\nR58N90ABCDE\tdevice\n";

    await expect(resolveAdbDevice({ isInteractive: false })).rejects.toThrow(/WEFTER_ADB_SERIAL/);
  });

  it("real prompt: pressing Enter picks the first listed device", async () => {
    nextOutput = "List of devices attached\nemulator-5554\tdevice\nR58N90ABCDE\tdevice\n";
    question.mockResolvedValue("");

    await expect(resolveAdbDevice({ isInteractive: true })).resolves.toMatchObject({ serial: "emulator-5554" });
    expect(close).toHaveBeenCalled();
  });

  it("real prompt: typing a number picks that device", async () => {
    nextOutput = "List of devices attached\nemulator-5554\tdevice\nR58N90ABCDE\tdevice\n";
    question.mockResolvedValue("2");

    await expect(resolveAdbDevice({ isInteractive: true })).resolves.toMatchObject({ serial: "R58N90ABCDE" });
  });

  it("lets WEFTER_ADB_SERIAL override selection entirely, without prompting", async () => {
    nextOutput = "List of devices attached\nemulator-5554\tdevice\nR58N90ABCDE\tdevice\n";
    process.env.WEFTER_ADB_SERIAL = "R58N90ABCDE";
    const prompt = vi.fn();

    await expect(resolveAdbDevice({ prompt })).resolves.toMatchObject({ serial: "R58N90ABCDE" });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("throws when WEFTER_ADB_SERIAL doesn't match any ready device", async () => {
    nextOutput = "List of devices attached\nemulator-5554\tdevice\n";
    process.env.WEFTER_ADB_SERIAL = "nonexistent";

    await expect(resolveAdbDevice()).rejects.toThrow(/WEFTER_ADB_SERIAL/);
  });
});
