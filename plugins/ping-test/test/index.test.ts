import { describe, expect, it, vi } from "vitest";

vi.mock("@wefter/core", () => ({
  invokeNative: vi.fn(() => Promise.resolve({ pong: true })),
  registerHook: vi.fn((_name: string, _cb: (data: unknown) => void) => ({ remove: vi.fn() })),
}));

import { invokeNative, registerHook } from "@wefter/core";
import { PingTest } from "../src/index.js";

describe("PingTest.ping", () => {
  it("calls invokeNative with the ping-test plugin and ping method", async () => {
    const result = await PingTest.ping();

    expect(invokeNative).toHaveBeenCalledWith("ping-test", "ping");
    expect(result).toEqual({ pong: true });
  });
});

describe("PingTest.on", () => {
  it("registers a hook named tick and returns its remove handle", () => {
    const callback = vi.fn();

    const handle = PingTest.on("tick", callback);

    expect(registerHook).toHaveBeenCalledWith("tick", expect.any(Function));
    expect(handle.remove).toBeTypeOf("function");
  });
});
