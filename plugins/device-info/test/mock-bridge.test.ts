// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installMockBridge, uninstallMockBridge } from "@wefter/core/testing";
import { Device } from "../src/index.js";

afterEach(() => {
  uninstallMockBridge();
});

describe("Device.getInfo against the mock bridge", () => {
  it("resolves with whatever the mock handler for device-info returns", async () => {
    installMockBridge({
      "device-info": (method) => {
        if (method === "getInfo") return { platform: "android", osVersion: "14" };
        throw new Error(`unexpected method ${method}`);
      },
    });

    const info = await Device.getInfo();

    expect(info).toEqual({ platform: "android", osVersion: "14" });
  });

  it("rejects with NO_MOCK_HANDLER when no handler is registered for the plugin", async () => {
    installMockBridge({});

    await expect(Device.getInfo()).rejects.toMatchObject({ code: "NO_MOCK_HANDLER" });
  });

  it("rejects with MOCK_ERROR when the handler itself throws", async () => {
    installMockBridge({
      "device-info": () => {
        throw new Error("simulated native failure");
      },
    });

    await expect(Device.getInfo()).rejects.toMatchObject({
      code: "MOCK_ERROR",
      message: "simulated native failure",
    });
  });
});
