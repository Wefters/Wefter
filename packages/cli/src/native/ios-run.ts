import { execFile, spawn } from "node:child_process";

export interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

interface SimctlListOutput {
  devices: Record<string, SimctlDevice[]>;
}

export function findSimulator(simctlListJson: string, nameOrUdid: string): SimctlDevice | null {
  const parsed = JSON.parse(simctlListJson) as SimctlListOutput;
  for (const devices of Object.values(parsed.devices)) {
    for (const device of devices) {
      if (device.udid === nameOrUdid || device.name === nameOrUdid) return device;
    }
  }
  return null;
}

export function pickDefaultSimulator(simctlListJson: string): string | null {
  const parsed = JSON.parse(simctlListJson) as SimctlListOutput;
  for (const devices of Object.values(parsed.devices)) {
    const candidate = devices.find((d) => d.isAvailable && d.name.startsWith("iPhone"));
    if (candidate) return candidate.name;
  }
  return null;
}

function listSimulatorsJson(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("xcrun", ["simctl", "list", "devices", "-j"], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function runXcrun(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("xcrun", args, { stdio: "inherit" });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`xcrun ${args.join(" ")} failed with exit code ${code}`));
    });
    proc.on("error", reject);
  });
}

export async function resolveSimulator(requested?: string): Promise<string> {
  const json = await listSimulatorsJson();

  if (requested) {
    const device = findSimulator(json, requested);
    if (!device) {
      throw new Error(
        `No simulator found matching "${requested}". Run \`xcrun simctl list devices\` to see available simulators.`,
      );
    }
    return device.name;
  }

  const picked = pickDefaultSimulator(json);
  if (!picked) {
    throw new Error(
      "No available iPhone simulator found. Create one in Xcode (Window > Devices and Simulators) or pass --simulator explicitly.",
    );
  }
  return picked;
}

async function ensureBooted(simulator: string): Promise<void> {
  const json = await listSimulatorsJson();
  const device = findSimulator(json, simulator);
  if (!device) {
    throw new Error(`No simulator found matching "${simulator}".`);
  }
  if (device.state !== "Booted") {
    await runXcrun(["simctl", "boot", device.udid]);
  }
}

export async function installAndLaunchIos(appPath: string, bundleId: string, simulator: string): Promise<void> {
  await ensureBooted(simulator);
  await runXcrun(["simctl", "install", simulator, appPath]);
  await runXcrun(["simctl", "launch", simulator, bundleId]);
}
