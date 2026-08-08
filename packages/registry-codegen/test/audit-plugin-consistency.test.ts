import { describe, expect, it } from "vitest";
import { auditPluginConsistency } from "../src/audit-plugin-consistency.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";
import type { ExtractedHook, ExtractedMethod } from "../src/extract-wefter-plugin.js";

function mockPlugin(methods: string[], hooks: string[]): DiscoveredPlugin {
  return {
    packageDir: "/fake/scanner",
    manifest: {
      name: "scanner",
      permissions: { android: [], ios: {} },
      nativeDependencies: {},
      methods,
      hooks,
      events: [],
    },
  };
}

function method(name: string): ExtractedMethod {
  return { name, lineNumber: 1 };
}

function hook(hookName: string): ExtractedHook {
  return { hookName, methodName: `handle${hookName}`, lineNumber: 1 };
}

describe("auditPluginConsistency", () => {
  it("passes silently when declared and extracted methods/hooks match exactly", () => {
    const plugin = mockPlugin(["open", "close"], ["onPause"]);
    expect(() => auditPluginConsistency(plugin, [method("open"), method("close")], [hook("onPause")])).not.toThrow();
  });

  it("skips the methods check entirely when plugin.json declares no methods field", () => {
    const plugin = mockPlugin([], []);
    expect(() => auditPluginConsistency(plugin, [method("open"), method("close")], [])).not.toThrow();
  });

  it("skips the hooks check entirely when plugin.json declares no hooks field", () => {
    const plugin = mockPlugin(["open"], []);
    expect(() => auditPluginConsistency(plugin, [method("open")], [hook("onPause")])).not.toThrow();
  });

  it("throws naming the plugin and the exact missing method", () => {
    const plugin = mockPlugin(["open", "close"], []);
    expect(() => auditPluginConsistency(plugin, [method("open")], [])).toThrow(/scanner.*close/s);
  });

  it("throws naming the plugin and the exact undeclared method", () => {
    const plugin = mockPlugin(["open"], []);
    expect(() => auditPluginConsistency(plugin, [method("open"), method("close")], [])).toThrow(/scanner.*close/s);
  });

  it("throws for a hooks mismatch independently of methods matching", () => {
    const plugin = mockPlugin(["open"], ["onPause"]);
    expect(() => auditPluginConsistency(plugin, [method("open")], [])).toThrow(/hooks.*onPause/s);
  });

  it("reports both a methods and hooks mismatch together when both are wrong", () => {
    const plugin = mockPlugin(["open"], ["onPause"]);
    try {
      auditPluginConsistency(plugin, [method("close")], [hook("onResume")]);
      throw new Error("expected auditPluginConsistency to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/methods/);
      expect(message).toMatch(/hooks/);
    }
  });
});
