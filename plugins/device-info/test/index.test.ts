import { describe, expect, it, vi } from "vitest";

vi.mock("@wefter/core", () => ({
  invokeNative: vi.fn(() => Promise.resolve({ platform: "android", osVersion: "14" })),
}));

import { invokeNative } from "@wefter/core";
import { Device } from "../src/index.js";

describe("Device.getInfo", () => {
  it("calls invokeNative with the device-info plugin and getInfo method", async () => {
    const result = await Device.getInfo();

    expect(invokeNative).toHaveBeenCalledWith("device-info", "getInfo");
    expect(result).toEqual({ platform: "android", osVersion: "14" });
  });
});
