import { describe, expect, it } from "vitest";

describe("package.json exports field", () => {
  it("allows importing the declared public entrypoint", async () => {
    const mod = await import("@wefterjs/core");
    expect(typeof mod.invokeNative).toBe("function");
  });

  it("allows importing the declared testing entrypoint", async () => {
    const mod = await import("@wefterjs/core/testing");
    expect(typeof mod.installMockBridge).toBe("function");
  });

  it("blocks importing an internal path that was never listed in exports", async () => {
    const internalSpecifier = "@wefterjs/core/internal/native-bridge.js";
    await expect(import( internalSpecifier)).rejects.toThrow();
  });
});
