/**
 * Finds the address of this machine on the local network, which a phone or emulator uses to reach the
 * dev server.
 */

import { networkInterfaces } from "node:os";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import logger from "../utils/logger.js";

/** A network interface and its IPv4 address. */
export interface LanIpCandidate {
  name: string;
  address: string;
}

/** Interfaces a phone cannot reach: containers, VMs, VPNs and tunnels. */
const VIRTUAL_INTERFACE_PATTERN = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|ppp|utun|zt|tailscale|wg)/i;
/** Wi-Fi interfaces, preferred because phones usually share the Wi-Fi network. */
const WIFI_INTERFACE_PATTERN = /^(wlan|wlp|wl[0-9]|wifi|airport|en0)/i;

/** External IPv4 addresses of all physical interfaces. */
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

/** The Wi-Fi address if there is one, else the first. */
function pickRecommended(candidates: LanIpCandidate[]): LanIpCandidate {
  return candidates.find((c) => WIFI_INTERFACE_PATTERN.test(c.name)) ?? candidates[0];
}

/**
 * The address to use, without asking. `WEFTER_LAN_IP` overrides detection.
 *
 * @throws {Error} When the machine has no network address.
 */
export function getLanIp(): string {
  const override = process.env.WEFTER_LAN_IP;
  if (override) return override;

  const candidates = getLanIpCandidates();
  if (candidates.length === 0) {
    throw new Error("No LAN IP found — is the machine connected to a network?");
  }

  return pickRecommended(candidates).address;
}

/** Asks which interface to use, by number, name or address. Enter picks the recommended one. */
async function promptForLanIp(candidates: LanIpCandidate[]): Promise<string> {
  const recommended = pickRecommended(candidates);
  const recommendedIndex = candidates.indexOf(recommended) + 1;

  logger.warn("Multiple network interfaces found — pick the one your phone can reach:");
  for (const [i, candidate] of candidates.entries()) {
    logger.segmentColor([
      { text: `  ${i + 1}) `, bold: true },
      { text: candidate.name, color: "cyan", bold: true },
      { text: `  ${candidate.address}`, color: "gray" },
      ...(candidate === recommended ? [{ text: " (recommended)", color: "green" as const }] : []),
    ]);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(chalk.bold(`Interface to use [${recommendedIndex}]: `))).trim();
    if (answer === "") return recommended.address;

    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= candidates.length) {
      return candidates[index - 1].address;
    }

    const byNameOrAddress = candidates.find((c) => c.address === answer || c.name === answer);
    if (byNameOrAddress) return byNameOrAddress.address;

    logger.warn(`Unrecognized choice "${answer}" — using the recommended interface (${recommended.name}).`);
    return recommended.address;
  } finally {
    rl.close();
  }
}

/** Options for {@link resolveLanIp}; mainly for tests. */
export interface ResolveLanIpOptions {
  isInteractive?: boolean;
  prompt?: (candidates: LanIpCandidate[]) => Promise<string>;
}

/**
 * The address to use, asking the user when there are several and the terminal is interactive.
 * `WEFTER_LAN_IP` overrides everything; without a terminal the recommended address is used with a warning.
 *
 * @throws {Error} When the machine has no network address.
 */
export async function resolveLanIp(options: ResolveLanIpOptions = {}): Promise<string> {
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
    logger.info(`Using network interface ${chalk.bold(only.name)} → ${chalk.cyan(only.address)}`);
    return only.address;
  }

  const isInteractive = options.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
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
