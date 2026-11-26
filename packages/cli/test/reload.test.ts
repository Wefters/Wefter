import { afterEach, describe, expect, it, vi } from "vitest";
import { DEVTOOLS_RELOAD_ROUTE, reloadApp, requestWebViewReload } from "../src/devserver/reload.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestWebViewReload", () => {
  it("POSTs to the devtools reload route and returns how many apps reloaded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ clients: 2 }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestWebViewReload("http://10.0.0.2:5173")).resolves.toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://10.0.0.2:5173${DEVTOOLS_RELOAD_ROUTE}`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null when devtools isn't installed (404) or answers something unexpected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(requestWebViewReload("http://x")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(requestWebViewReload("http://x")).resolves.toBeNull();
  });

  it("returns null when the dev server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(requestWebViewReload("http://x")).resolves.toBeNull();
  });
});

describe("reloadApp", () => {
  it("reloads the web view when an app is connected to the dev server", async () => {
    const restart = vi.fn();
    const outcome = await reloadApp("http://x", restart, async () => 1);
    expect(outcome).toEqual({ kind: "reloaded", clients: 1 });
    expect(restart).not.toHaveBeenCalled();
  });

  it("restarts the app natively when no app is connected", async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    await expect(reloadApp("http://x", restart, async () => 0)).resolves.toEqual({ kind: "restarted" });
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("restarts the app natively when devtools can't be asked", async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    await expect(reloadApp("http://x", restart, async () => null)).resolves.toEqual({ kind: "restarted" });
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("restarts the app natively when there is no dev server", async () => {
    const request = vi.fn();
    const restart = vi.fn().mockResolvedValue(undefined);
    await reloadApp(null, restart, request);
    expect(request).not.toHaveBeenCalled();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed restart so the session can report it", async () => {
    await expect(
      reloadApp(
        "http://x",
        () => Promise.reject(new Error("device offline")),
        async () => 0,
      ),
    ).rejects.toThrow("device offline");
  });
});
