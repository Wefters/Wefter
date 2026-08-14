import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { getLanIp, getLanIpCandidates, resolveLanIp } from "../src/devserver/lan-ip.js";

vi.mock("node:os", () => ({
  networkInterfaces: vi.fn(),
}));

const question = vi.fn();
const close = vi.fn();
vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(() => ({ question, close })),
}));

describe("getLanIp", () => {
  const originalOverride = process.env.WEFTER_LAN_IP;

  beforeEach(() => {
    delete process.env.WEFTER_LAN_IP;
  });

  afterEach(() => {
    if (originalOverride === undefined) delete process.env.WEFTER_LAN_IP;
    else process.env.WEFTER_LAN_IP = originalOverride;
  });

  it("skips internal (loopback) and non-IPv4 interfaces, returning the first real LAN address", () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true } as unknown as NetworkInterfaceInfo],
      eth0: [
        { address: "fe80::1", family: "IPv6", internal: false } as unknown as NetworkInterfaceInfo,
        { address: "192.168.1.42", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo,
      ],
    });

    expect(getLanIp()).toBe("192.168.1.42");
  });

  it("throws clearly when no external IPv4 interface is found", () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true } as unknown as NetworkInterfaceInfo],
    });

    expect(() => getLanIp()).toThrow(/No LAN IP found/);
  });

  it("ignores docker/veth/tunnel interfaces — they're never reachable from a phone", () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
      veth1234: [{ address: "172.17.0.5", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
      tun0: [{ address: "10.8.0.2", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
      wlan0: [{ address: "192.168.1.42", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
    });

    expect(getLanIp()).toBe("192.168.1.42");
    expect(getLanIpCandidates()).toEqual([{ name: "wlan0", address: "192.168.1.42" }]);
  });

  it("prefers a Wi-Fi interface over Ethernet when a machine has both up at once", () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      enp1s0: [{ address: "192.168.18.21", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
      wlp2s0: [{ address: "192.168.18.54", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
    });

    expect(getLanIp()).toBe("192.168.18.54");
    expect(getLanIpCandidates()).toHaveLength(2);
  });

  it("lets WEFTER_LAN_IP override the auto-detected address entirely", () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [{ address: "192.168.1.42", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
    });
    process.env.WEFTER_LAN_IP = "192.168.1.99";

    expect(getLanIp()).toBe("192.168.1.99");
  });
});

describe("resolveLanIp", () => {
  const originalOverride = process.env.WEFTER_LAN_IP;

  beforeEach(() => {
    delete process.env.WEFTER_LAN_IP;
    question.mockReset();
    close.mockReset();
  });

  afterEach(() => {
    if (originalOverride === undefined) delete process.env.WEFTER_LAN_IP;
    else process.env.WEFTER_LAN_IP = originalOverride;
  });

  it("returns the WEFTER_LAN_IP override without touching interfaces or prompting", async () => {
    process.env.WEFTER_LAN_IP = "192.168.1.99";
    const prompt = vi.fn();

    await expect(resolveLanIp({ prompt })).resolves.toBe("192.168.1.99");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("returns the only candidate directly, without prompting", async () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [{ address: "192.168.1.42", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
    });
    const prompt = vi.fn();

    await expect(resolveLanIp({ prompt })).resolves.toBe("192.168.1.42");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("throws when no candidate interface exists at all", async () => {
    vi.mocked(networkInterfaces).mockReturnValue({});

    await expect(resolveLanIp()).rejects.toThrow(/No LAN IP found/);
  });

  it("falls back to the Wi-Fi-preferred heuristic when not interactive, without prompting", async () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      enp1s0: [{ address: "192.168.18.21", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
      wlp2s0: [{ address: "192.168.18.54", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
    });
    const prompt = vi.fn();

    await expect(resolveLanIp({ isInteractive: false, prompt })).resolves.toBe("192.168.18.54");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("delegates to the injected prompt when interactive, passing every candidate", async () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      enp1s0: [{ address: "192.168.18.21", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
      wlp2s0: [{ address: "192.168.18.54", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
    });
    const prompt = vi.fn().mockResolvedValue("192.168.18.21");

    await expect(resolveLanIp({ isInteractive: true, prompt })).resolves.toBe("192.168.18.21");
    expect(prompt).toHaveBeenCalledWith([
      { name: "enp1s0", address: "192.168.18.21" },
      { name: "wlp2s0", address: "192.168.18.54" },
    ]);
  });

  it("real prompt: pressing Enter picks the recommended (Wi-Fi) interface", async () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      enp1s0: [{ address: "192.168.18.21", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
      wlp2s0: [{ address: "192.168.18.54", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
    });
    question.mockResolvedValue("");

    await expect(resolveLanIp({ isInteractive: true })).resolves.toBe("192.168.18.54");
    expect(close).toHaveBeenCalled();
  });

  it("real prompt: typing a number picks that candidate", async () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      enp1s0: [{ address: "192.168.18.21", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
      wlp2s0: [{ address: "192.168.18.54", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
    });
    question.mockResolvedValue("1");

    await expect(resolveLanIp({ isInteractive: true })).resolves.toBe("192.168.18.21");
  });

  it("real prompt: an unrecognized answer falls back to the recommended interface", async () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      enp1s0: [{ address: "192.168.18.21", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
      wlp2s0: [{ address: "192.168.18.54", family: "IPv4", internal: false } as unknown as NetworkInterfaceInfo],
    });
    question.mockResolvedValue("nonsense");

    await expect(resolveLanIp({ isInteractive: true })).resolves.toBe("192.168.18.54");
  });
});
