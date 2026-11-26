/** Finds, boots and controls iOS simulators with `xcrun simctl`. */

import { execFile } from "node:child_process";
import { runProcess } from "../process/run-process.js";
import { diagnoseSimctl } from "./ios-diagnostics.js";

/** A simulator as listed by `simctl list devices -j`. */
export interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

/** The JSON printed by `simctl list devices -j`: simulators by runtime. */
interface SimctlListOutput {
  devices: Record<string, SimctlDevice[]>;
}

/** A simulator with the runtime it belongs to. */
interface RankedDevice {
  device: SimctlDevice;
  isIos: boolean;
  runtimeVersion: number[];
}

/** Platform and version from a runtime key such as `com.apple.CoreSimulator.SimRuntime.iOS-17-2`. */
function parseRuntime(runtimeKey: string): { isIos: boolean; version: number[] } {
  const match = /SimRuntime\.([A-Za-z]+)-([\d-]+)$/.exec(runtimeKey);
  if (!match) return { isIos: false, version: [] };
  return { isIos: match[1] === "iOS", version: match[2]!.split("-").map(Number) };
}

/** Orders versions newest first. */
function compareVersionsDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** All simulators, booted ones first, then newest runtime first. */
function rankDevices(simctlListJson: string): RankedDevice[] {
  const parsed = JSON.parse(simctlListJson) as SimctlListOutput;
  const ranked: RankedDevice[] = [];
  for (const [runtimeKey, devices] of Object.entries(parsed.devices)) {
    const { isIos, version } = parseRuntime(runtimeKey);
    for (const device of devices) ranked.push({ device, isIos, runtimeVersion: version });
  }
  return ranked.sort((a, b) => {
    const booted = Number(b.device.state === "Booted") - Number(a.device.state === "Booted");
    if (booted !== 0) return booted;
    return compareVersionsDesc(a.runtimeVersion, b.runtimeVersion);
  });
}

/** The simulator with this name or UDID, preferring an available one. */
export function findSimulator(simctlListJson: string, nameOrUdid: string): SimctlDevice | null {
  const matches = rankDevices(simctlListJson)
    .map((r) => r.device)
    .filter((d) => d.udid === nameOrUdid || d.name === nameOrUdid);
  return matches.find((d) => d.isAvailable) ?? matches[0] ?? null;
}

/** The best iPhone simulator to use when none was requested: booted first, then newest iOS. */
export function pickDefaultSimulator(simctlListJson: string): SimctlDevice | null {
  const candidate = rankDevices(simctlListJson).find(
    (r) => r.isIos && r.device.isAvailable && r.device.name.startsWith("iPhone"),
  );
  return candidate?.device ?? null;
}

/** Runs `simctl list devices -j`. */
function listSimulatorsJson(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("xcrun", ["simctl", "list", "devices", "-j"], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** Runs an `xcrun` command quietly, with simctl diagnostics on failure. */
function runXcrun(args: string[]): Promise<void> {
  return runProcess("xcrun", args, { tool: "Simulator", diagnose: diagnoseSimctl }).then(() => undefined);
}

/**
 * The simulator to run on: the requested one, or the default.
 *
 * @throws {Error} When the requested simulator does not exist or no iPhone simulator is available.
 */
export async function resolveSimulator(requested?: string): Promise<SimctlDevice> {
  const json = await listSimulatorsJson();

  if (requested) {
    const device = findSimulator(json, requested);
    if (!device) {
      throw new Error(
        `No simulator found matching "${requested}". Run \`xcrun simctl list devices\` to see available simulators.`,
      );
    }
    return device;
  }

  const picked = pickDefaultSimulator(json);
  if (!picked) {
    throw new Error(
      "No available iPhone simulator found. Create one in Xcode (Window > Devices and Simulators) or pass --simulator explicitly.",
    );
  }
  return picked;
}

/** Boots the simulator if it is not running yet. */
async function ensureBooted(nameOrUdid: string): Promise<SimctlDevice> {
  const json = await listSimulatorsJson();
  const device = findSimulator(json, nameOrUdid);
  if (!device) {
    throw new Error(`No simulator found matching "${nameOrUdid}".`);
  }
  if (device.state !== "Booted") {
    await runXcrun(["simctl", "boot", device.udid]);
  }
  return device;
}

/** Boots the simulator if needed, installs the app and launches it. */
export async function installAndLaunchIos(appPath: string, bundleId: string, simulator: string): Promise<void> {
  const device = await ensureBooted(simulator);
  await installIosApp(appPath, device.udid);
  await launchIosApp(bundleId, device.udid);
}

/**
 * Boots the simulator if it is not running yet.
 *
 * @returns Whether it had to be booted.
 */
export async function bootSimulator(nameOrUdid: string): Promise<boolean> {
  const json = await listSimulatorsJson();
  const device = findSimulator(json, nameOrUdid);
  if (!device) throw new Error(`No simulator found matching "${nameOrUdid}".`);
  if (device.state === "Booted") return false;
  await runXcrun(["simctl", "boot", device.udid]);
  return true;
}

/** Installs or updates the app on a simulator. */
export async function installIosApp(appPath: string, udid: string): Promise<void> {
  await runXcrun(["simctl", "install", udid, appPath]);
}

/** Launches the app on a simulator. */
export async function launchIosApp(bundleId: string, udid: string): Promise<void> {
  await runXcrun(["simctl", "launch", udid, bundleId]);
}

/** Terminates the app (ignoring "not running") and launches it again. */
export async function restartIosApp(bundleId: string, udid: string): Promise<void> {
  await runXcrun(["simctl", "terminate", udid, bundleId]).catch(() => undefined);
  await launchIosApp(bundleId, udid);
}
