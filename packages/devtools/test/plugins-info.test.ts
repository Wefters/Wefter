import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPluginInfo } from "../src/server/plugins-info.js";

let dir: string | undefined;

function project(): string {
  dir = mkdtempSync(join(tmpdir(), "wefter-devtools-test-"));
  return dir;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("collectPluginInfo", () => {
  it("returns an empty list when there is no wefter.config.json", () => {
    expect(collectPluginInfo(project())).toEqual([]);
  });

  it("returns an empty list when wefter.config.json has no plugins array", () => {
    const root = project();
    writeJson(join(root, "wefter.config.json"), {});
    expect(collectPluginInfo(root)).toEqual([]);
  });

  it("defaults pluginsDir to node_modules", () => {
    const root = project();
    writeJson(join(root, "wefter.config.json"), { plugins: ["haptics"] });
    writeJson(join(root, "node_modules", "haptics", "plugin.json"), { methods: ["vibrate"] });

    const [info] = collectPluginInfo(root);
    expect(info?.methods).toEqual(["vibrate"]);
  });

  it("reads methods/hooks/events and android permissions from plugin.json", () => {
    const root = project();
    writeJson(join(root, "wefter.config.json"), { plugins: ["haptics"], pluginsDir: "plugins" });
    writeJson(join(root, "plugins", "haptics", "plugin.json"), {
      methods: ["vibrate", "impact"],
      hooks: ["onResume"],
      events: ["shake"],
      permissions: { android: ["VIBRATE"] },
    });
    mkdirSync(join(root, "plugins", "haptics", "android"), { recursive: true });

    const [info] = collectPluginInfo(root);
    expect(info).toEqual({
      id: "haptics",
      methods: ["vibrate", "impact"],
      hooks: ["onResume"],
      events: ["shake"],
      androidPermissions: ["VIBRATE"],
      iosPermissions: [],
      hasAndroidSource: true,
      hasIosSource: false,
    });
  });

  it("flattens an iOS permissions object (usage-description map) to just its keys", () => {
    const root = project();
    writeJson(join(root, "wefter.config.json"), { plugins: ["camera"], pluginsDir: "plugins" });
    writeJson(join(root, "plugins", "camera", "plugin.json"), {
      permissions: { ios: { NSCameraUsageDescription: "Take photos" } },
    });
    mkdirSync(join(root, "plugins", "camera", "ios"), { recursive: true });

    const [info] = collectPluginInfo(root);
    expect(info?.iosPermissions).toEqual(["NSCameraUsageDescription"]);
    expect(info?.hasIosSource).toBe(true);
  });

  it("accepts an iOS permissions array as-is", () => {
    const root = project();
    writeJson(join(root, "wefter.config.json"), { plugins: ["camera"], pluginsDir: "plugins" });
    writeJson(join(root, "plugins", "camera", "plugin.json"), {
      permissions: { ios: ["NSCameraUsageDescription"] },
    });

    const [info] = collectPluginInfo(root);
    expect(info?.iosPermissions).toEqual(["NSCameraUsageDescription"]);
  });

  it("defaults everything sensibly for a plugin with no plugin.json at all", () => {
    const root = project();
    writeJson(join(root, "wefter.config.json"), { plugins: ["ghost"], pluginsDir: "plugins" });

    const [info] = collectPluginInfo(root);
    expect(info).toEqual({
      id: "ghost",
      methods: [],
      hooks: [],
      events: [],
      androidPermissions: [],
      iosPermissions: [],
      hasAndroidSource: false,
      hasIosSource: false,
    });
  });

  it("returns one entry per configured plugin, in config order", () => {
    const root = project();
    writeJson(join(root, "wefter.config.json"), { plugins: ["a", "b", "c"], pluginsDir: "plugins" });

    const infos = collectPluginInfo(root);
    expect(infos.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});
