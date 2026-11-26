import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { openCommandFor, openUrl } = await import("../src/utils/open-url.js");

afterEach(() => spawnMock.mockReset());

describe("openCommandFor", () => {
  it.each([
    ["darwin", "open", ["http://x"]],
    ["linux", "xdg-open", ["http://x"]],
    ["win32", "cmd", ["/c", "start", '""', "http://x"]],
  ] as const)("uses the %s opener", (platform, command, args) => {
    expect(openCommandFor(platform, "http://x")).toEqual([command, args]);
  });
});

describe("openUrl", () => {
  it("resolves true once the opener starts, detached so it doesn't hold the CLI open", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawnMock.mockReturnValueOnce(child);
    const opened = openUrl("http://x", "darwin");
    child.emit("spawn");

    await expect(opened).resolves.toBe(true);
    expect(spawnMock).toHaveBeenCalledWith("open", ["http://x"], { stdio: "ignore", detached: true });
    expect(child.unref).toHaveBeenCalled();
  });

  it("resolves false when there is no opener", async () => {
    const child = new EventEmitter();
    spawnMock.mockReturnValueOnce(child);
    const opened = openUrl("http://x", "linux");
    child.emit("error", new Error("spawn xdg-open ENOENT"));

    await expect(opened).resolves.toBe(false);
  });
});
