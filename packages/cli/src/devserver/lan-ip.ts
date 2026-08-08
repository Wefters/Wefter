import { networkInterfaces } from "node:os";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import logger from "../utils/logger.js";

export interface LanIpCandidate {
  name: string;
  address: string;
}

const VIRTUAL_INTERFACE_PATTERN =
  /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|ppp|utun|zt|tailscale|wg)/i;
const WIFI_INTERFACE_PATTERN = /^(wlan|wlp|wl[0-9]|wifi|airport|en0)/i;

export function getLanIpCandidates(): LanIpCandidate[] {
  const interfaces = networkInterfaces();
  const candidates: LanIpCandidate[] = [];

  for (const name of Object.keys(interfaces)) {
    if (VIRTUAL_INTERFACE_PATTERN.test(name)) continue;
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }

  return candidates;
}

function pickRecommended(candidates: LanIpCandidate[]): LanIpCandidate {
  return (
    candidates.find((c) => WIFI_INTERFACE_PATTERN.test(c.name)) ?? candidates[0]
  );
}

export function getLanIp(): string {
  const override = process.env.WEFTER_LAN_IP;
  if (override) return override;

  const candidates = getLanIpCandidates();
  if (candidates.length === 0) {
    throw new Error("No LAN IP found — is the machine connected to a network?");
  }

  return pickRecommended(candidates).address;
}

async function promptForLanIp(candidates: LanIpCandidate[]): Promise<string> {
  const recommended = pickRecommended(candidates);
  const recommendedIndex = candidates.indexOf(recommended) + 1;

  logger.warn(
    "Multiple network interfaces found — pick the one your phone can reach:",
  );
  for (const [i, candidate] of candidates.entries()) {
    logger.segmentColor([
      { text: `  ${i + 1}) `, bold: true },
      { text: candidate.name, color: "cyan", bold: true },
      { text: `  ${candidate.address}`, color: "gray" },
      ...(candidate === recommended
        ? [{ text: " (recommended)", color: "green" as const }]
        : []),
    ]);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question(chalk.bold(`Interface to use [${recommendedIndex}]: `))
    ).trim();
    if (answer === "") return recommended.address;

    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= candidates.length) {
      return candidates[index - 1].address;
    }

    const byNameOrAddress = candidates.find(
      (c) => c.address === answer || c.name === answer,
    );
    if (byNameOrAddress) return byNameOrAddress.address;

    logger.warn(
      `Unrecognized choice "${answer}" — using the recommended interface (${recommended.name}).`,
    );
    return recommended.address;
  } finally {
    rl.close();
  }
}

export interface ResolveLanIpOptions {
  isInteractive?: boolean;
  prompt?: (candidates: LanIpCandidate[]) => Promise<string>;
}

export async function resolveLanIp(
  options: ResolveLanIpOptions = {},
): Promise<string> {
  const override = process.env.WEFTER_LAN_IP;
  if (override) {
    logger.info(`Using WEFTER_LAN_IP override → ${chalk.cyan(override)}`);
    return override;
  }

  const candidates = getLanIpCandidates();
  if (candidates.length === 0) {
    throw new Error("No LAN IP found — is the machine connected to a network?");
  }

  if (candidates.length === 1) {
    const [only] = candidates;
    logger.info(
      `Using network interface ${chalk.bold(only.name)} → ${chalk.cyan(only.address)}`,
    );
    return only.address;
  }

  const isInteractive =
    options.isInteractive ??
    (process.stdin.isTTY === true && process.stdout.isTTY === true);
  if (!isInteractive) {
    const fallback = pickRecommended(candidates);
    const list = candidates.map((c) => `${c.name}=${c.address}`).join(", ");
    logger.warn(
      `Multiple network interfaces found (${list}) and no interactive terminal — defaulting to ` +
        `${fallback.name} (${fallback.address}). Set WEFTER_LAN_IP to override.`,
    );
    return fallback.address;
  }

  const prompt = options.prompt ?? promptForLanIp;
  const chosen = await prompt(candidates);
  logger.info(`Using ${chalk.cyan(chosen)}`);
  return chosen;
}
