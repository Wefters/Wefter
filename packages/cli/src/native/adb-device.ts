/** Picks the Android device or emulator to install on. */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import logger from "../utils/logger.js";

/** A device as listed by `adb devices -l`. `state` is `device` when it is ready. */
export interface AdbDevice {
  serial: string;
  state: string;
  model?: string;
}

/**
 * Runs `adb` and resolves with its stdout.
 *
 * @throws {Error} When adb is missing or fails.
 */
function runAdbCapture(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("adb", args);
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    proc.stderr?.on("data", (chunk) => (stderr += chunk.toString()));

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("adb not found on PATH — install Android platform-tools and try again."));
      } else {
        reject(err);
      }
    });

    proc.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`adb ${args.join(" ")} failed: ${stderr.trim() || `exit code ${code}`}`));
    });
  });
}

/**
 * Makes `localhost:<port>` on the device reach the same port on this computer (`adb reverse`), so the app
 * can load the dev server from `localhost`. Web views treat `localhost` as a secure origin, where the
 * camera, microphone and location work; a network address such as `192.168.1.20` is not one.
 *
 * @returns Whether it worked.
 */
export async function reverseAdbPort(serial: string, port: number): Promise<boolean> {
  try {
    await runAdbCapture(["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
    return true;
  } catch {
    return false;
  }
}

/** Every device adb knows about, ready or not. */
export async function listAdbDevices(): Promise<AdbDevice[]> {
  const output = await runAdbCapture(["devices", "-l"]);
  const devices: AdbDevice[] = [];

  for (const line of output.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const parts = trimmed.split(/\s+/);
    const [serial, state] = parts;
    const modelPart = parts.find((p) => p.startsWith("model:"));
    devices.push({ serial, state, model: modelPart?.slice("model:".length) });
  }

  return devices;
}

/** Model name when known, else the serial. */
function describeDevice(device: AdbDevice): string {
  return device.model ?? device.serial;
}

/** Asks which device to use, by number or serial. Enter picks the first. */
async function promptForAdbDevice(devices: AdbDevice[]): Promise<AdbDevice> {
  logger.warn("Multiple Android devices found — pick the one to install on:");
  for (const [i, device] of devices.entries()) {
    logger.segmentColor([
      { text: `  ${i + 1}) `, bold: true },
      { text: describeDevice(device), color: "cyan", bold: true },
      { text: `  ${device.serial}`, color: "gray" },
    ]);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(chalk.bold("Device to use [1]: "))).trim();
    if (answer === "") return devices[0];

    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= devices.length) {
      return devices[index - 1];
    }

    const bySerial = devices.find((d) => d.serial === answer);
    if (bySerial) return bySerial;

    logger.warn(`Unrecognized choice "${answer}" — using the first device (${devices[0].serial}).`);
    return devices[0];
  } finally {
    rl.close();
  }
}

/** Options for {@link resolveAdbDevice}; mainly for tests. */
export interface ResolveAdbDeviceOptions {
  isInteractive?: boolean;
  prompt?: (devices: AdbDevice[]) => Promise<AdbDevice>;
}

/**
 * The device to use. `WEFTER_ADB_SERIAL` picks one directly; a single ready device is used as is; with
 * several the user is asked.
 *
 * @throws {Error} When no device is ready (explaining unauthorised devices), the override does not match,
 * or several are connected without an interactive terminal.
 */
export async function resolveAdbDevice(options: ResolveAdbDeviceOptions = {}): Promise<AdbDevice> {
  const allEntries = await listAdbDevices();
  const ready = allEntries.filter((d) => d.state === "device");

  const override = process.env.WEFTER_ADB_SERIAL;
  if (override) {
    const match = ready.find((d) => d.serial === override);
    if (!match) {
      throw new Error(`WEFTER_ADB_SERIAL="${override}" is not among the connected, ready devices.`);
    }
    logger.info(`Using WEFTER_ADB_SERIAL override → ${chalk.cyan(match.serial)}`);
    return match;
  }

  if (ready.length === 0) {
    if (allEntries.length > 0) {
      const detail = allEntries.map((d) => `${d.serial} (${d.state})`).join(", ");
      throw new Error(
        `No ready Android device/emulator — connected but not ready: ${detail}. ` +
          `If a device shows "unauthorized", accept the USB debugging prompt on it and try again.`,
      );
    }
    throw new Error(
      "No Android device/emulator found. Connect a device with USB debugging enabled, or start an emulator, then try again.",
    );
  }

  if (ready.length === 1) {
    const [only] = ready;
    logger.info(`Using device ${chalk.bold(describeDevice(only))} → ${chalk.cyan(only.serial)}`);
    return only;
  }

  const isInteractive = options.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  if (!isInteractive) {
    const list = ready.map((d) => d.serial).join(", ");
    throw new Error(
      `Multiple Android devices found (${list}) and no interactive terminal — set WEFTER_ADB_SERIAL to pick one.`,
    );
  }

  const prompt = options.prompt ?? promptForAdbDevice;
  const chosen = await prompt(ready);
  logger.info(`Using ${chalk.cyan(chosen.serial)}`);
  return chosen;
}
