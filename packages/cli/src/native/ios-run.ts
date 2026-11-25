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

interface RankedDevice {
  device: SimctlDevice;
  isIos: boolean;
  runtimeVersion: number[];
}

function parseRuntime(runtimeKey: string): { isIos: boolean; version: number[] } {
  const match = /SimRuntime\.([A-Za-z]+)-([\d-]+)$/.exec(runtimeKey);
  if (!match) return { isIos: false, version: [] };
  return { isIos: match[1] === "iOS", version: match[2]!.split("-").map(Number) };
}

function compareVersionsDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

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

export function findSimulator(simctlListJson: string, nameOrUdid: string): SimctlDevice | null {
  const matches = rankDevices(simctlListJson)
    .map((r) => r.device)
    .filter((d) => d.udid === nameOrUdid || d.name === nameOrUdid);
  return matches.find((d) => d.isAvailable) ?? matches[0] ?? null;
}

export function pickDefaultSimulator(simctlListJson: string): SimctlDevice | null {
  const candidate = rankDevices(simctlListJson).find(
    (r) => r.isIos && r.device.isAvailable && r.device.name.startsWith("iPhone"),
  );
  return candidate?.device ?? null;
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

export async function installAndLaunchIos(appPath: string, bundleId: string, simulator: string): Promise<void> {
  const device = await ensureBooted(simulator);
  await runXcrun(["simctl", "install", device.udid, appPath]);
  await runXcrun(["simctl", "launch", device.udid, bundleId]);
}
