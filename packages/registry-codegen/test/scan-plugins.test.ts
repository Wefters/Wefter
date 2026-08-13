import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanPlugins } from "../src/scan-plugins.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../src/__fixtures__");

describe("scanPlugins", () => {
  it("reads a minimal well-formed plugin.json and fills in schema defaults", () => {
    const [discovered] = scanPlugins(fixturesDir, ["valid-plugin"]);

    expect(discovered.manifest).toEqual({
      name: "valid-plugin",
      permissions: { android: [], ios: {} },
      nativeDependencies: {},
      android: { manifestEntries: [] },
      methods: [],
      hooks: [],
      events: [],
    });
  });

  it("reads a fully populated plugin.json", () => {
    const [discovered] = scanPlugins(fixturesDir, ["full-plugin"]);

    expect(discovered.manifest).toEqual({
      name: "full-plugin",
      permissions: { android: ["android.permission.CAMERA"], ios: {} },
      nativeDependencies: { android: { gradle: ["com.google.zxing:core:3.5.3"] } },
      android: { manifestEntries: [] },
      methods: ["scan", "cancel"],
      hooks: ["onActivityResult"],
      events: ["result", "error"],
    });
  });

  it("throws referencing the offending package name for an invalid manifest", () => {
    expect(() => scanPlugins(fixturesDir, ["invalid-plugin"])).toThrow(/invalid-plugin/);
  });

  it("skips a listed package that has no plugin.json instead of crashing", () => {
    expect(scanPlugins(fixturesDir, ["does-not-exist"])).toEqual([]);
  });

  it("discovers multiple well-formed packages in one call", () => {
    const discovered = scanPlugins(fixturesDir, ["valid-plugin", "full-plugin"]);

    expect(discovered.map((p) => p.manifest.name)).toEqual(["valid-plugin", "full-plugin"]);
  });
});
