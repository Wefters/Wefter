import { describe, expect, it } from "vitest";
import { resolveSplash } from "../src/native/resolve-splash.js";
import { WefterConfigSchema, type WefterConfig } from "../src/config/wefter-config-schema.js";

function configWith(splash: unknown): WefterConfig {
  return WefterConfigSchema.parse({
    environments: { development: { appId: "com.example.app", appName: "Example" } },
    splash,
  });
}

describe("resolveSplash", () => {
  it("resolves to disabled when the splash key is absent", () => {
    const config = configWith(undefined);
    expect(resolveSplash(config)).toEqual({ enabled: false });
  });

  it("resolves to disabled when splash is explicitly false", () => {
    const config = configWith(false);
    expect(resolveSplash(config)).toEqual({ enabled: false });
  });

  it("absent key and explicit false produce identical output", () => {
    expect(resolveSplash(configWith(undefined))).toEqual(resolveSplash(configWith(false)));
  });

  it("resolves to enabled with the full config when splash is a valid object", () => {
    const config = configWith({ html: "splash.html", minDurationMs: 1200, fadeOutDurationMs: 500 });

    expect(resolveSplash(config)).toEqual({
      enabled: true,
      html: "splash.html",
      minDurationMs: 1200,
      fadeOutDurationMs: 500,
    });
  });

  it("applies schema defaults for minDurationMs/fadeOutDurationMs when omitted", () => {
    const config = configWith({ html: "splash.html" });

    expect(resolveSplash(config)).toEqual({
      enabled: true,
      html: "splash.html",
      minDurationMs: 600,
      fadeOutDurationMs: 300,
    });
  });
});
