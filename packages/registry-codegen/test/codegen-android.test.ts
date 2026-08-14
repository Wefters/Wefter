import { describe, expect, it, test } from "vitest";
import { classNameFor, generateRegistryKotlin, type PluginExtraction } from "../src/codegen-android.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";

function mockPlugin(name: string): DiscoveredPlugin {
  return {
    packageDir: `/fake/${name}`,
    manifest: {
      name,
      permissions: { android: [], ios: {} },
      nativeDependencies: {},
      methods: [],
      hooks: [],
      events: [],
    },
  };
}

const deviceMock = mockPlugin("device-info");
const pingMock = mockPlugin("ping-test");

describe("classNameFor", () => {
  it("PascalCases a kebab-case plugin name and appends Plugin", () => {
    expect(classNameFor("device-info")).toBe("DeviceInfoPlugin");
  });

  it("PascalCases a camelCase plugin name and appends Plugin", () => {
    expect(classNameFor("secureStorage")).toBe("SecureStoragePlugin");
  });

  it("handles a single-word plugin name", () => {
    expect(classNameFor("scanner")).toBe("ScannerPlugin");
  });
});

describe("generateRegistryKotlin", () => {
  it("registers each plugin using the fixed PascalCase(name) + Plugin convention", () => {
    const kt = generateRegistryKotlin([deviceMock], "dev.wefter.bridge");

    expect(kt).toContain('dispatcher.register("device-info", DeviceInfoPlugin())');
  });

  it("produces exactly one registerAll function on the GeneratedRegistry object, taking a Context", () => {
    const kt = generateRegistryKotlin([deviceMock, pingMock], "dev.wefter.bridge");

    expect(kt).toContain("object GeneratedRegistry");
    expect(kt).toContain("fun registerAll(context: Context, dispatcher: BridgeDispatcher)");
    expect(kt).toContain("import android.content.Context");
  });

  test("regenerating with fewer plugins removes stale registrations", () => {
    const withTwo = generateRegistryKotlin([deviceMock, pingMock], "dev.wefter.bridge");
    const withOne = generateRegistryKotlin([deviceMock], "dev.wefter.bridge");

    expect(withTwo).toContain("PingTestPlugin");
    expect(withOne).not.toContain("PingTestPlugin");
  });

  test("running generateRegistryKotlin twice with no plugin changes produces identical output", () => {
    const first = generateRegistryKotlin([deviceMock, pingMock], "dev.wefter.bridge");
    const second = generateRegistryKotlin([deviceMock, pingMock], "dev.wefter.bridge");

    expect(first).toBe(second);
  });

  it("declares the package the caller asks for, not a fixed one", () => {
    const kt = generateRegistryKotlin([deviceMock], "com.example.myapp");

    expect(kt).toContain("package com.example.myapp");
  });
});

describe("generateRegistryKotlin — @WefterMethod dispatch", () => {
  it("with zero extracted methods, keeps the legacy direct-registration line unchanged", () => {
    const kt = generateRegistryKotlin([deviceMock], "dev.wefter.bridge", new Map());

    expect(kt).toContain('dispatcher.register("device-info", DeviceInfoPlugin())');
    expect(kt).not.toContain("DeviceInfoPluginDispatch");
  });

  it("with one extracted method, generates a Dispatch wrapper and constructs the plugin with (context, dispatcher)", () => {
    const extraction = new Map<string, PluginExtraction>([
      ["device-info", { methods: [{ name: "getInfo", lineNumber: 5 }], hooks: [] }],
    ]);

    const kt = generateRegistryKotlin([deviceMock], "dev.wefter.bridge", extraction);

    expect(kt).toContain("class DeviceInfoPluginDispatch(private val plugin: DeviceInfoPlugin) : NativeModule {");
    expect(kt).toContain('"getInfo" -> plugin.getInfo(payload, callback)');
    expect(kt).toContain('else -> callback(Result.failure(WefterError("UNKNOWN_METHOD", "No such method: $method")))');
    expect(kt).toContain("val deviceInfoPlugin = DeviceInfoPlugin(context, dispatcher)");
    expect(kt).toContain('dispatcher.register("device-info", DeviceInfoPluginDispatch(deviceInfoPlugin))');
  });

  it("registers the constructed plugin instance with WefterBridge alongside the dispatcher", () => {
    const extraction = new Map<string, PluginExtraction>([
      ["device-info", { methods: [{ name: "getInfo", lineNumber: 5 }], hooks: [] }],
    ]);

    const kt = generateRegistryKotlin([deviceMock], "dev.wefter.bridge", extraction);

    expect(kt).toContain('WefterBridge.register("device-info", deviceInfoPlugin)');
  });

  it("does NOT register with WefterBridge on the legacy zero-methods branch", () => {
    const kt = generateRegistryKotlin([deviceMock], "dev.wefter.bridge", new Map());

    expect(kt).not.toContain("WefterBridge.register");
  });

  it("with multiple methods, every method gets its own when-branch, all on the same instance", () => {
    const extraction = new Map<string, PluginExtraction>([
      [
        "ping-test",
        {
          methods: [
            { name: "ping", lineNumber: 3 },
            { name: "reset", lineNumber: 9 },
          ],
          hooks: [],
        },
      ],
    ]);

    const kt = generateRegistryKotlin([pingMock], "dev.wefter.bridge", extraction);

    expect(kt).toContain('"ping" -> plugin.ping(payload, callback)');
    expect(kt).toContain('"reset" -> plugin.reset(payload, callback)');
    expect((kt.match(/PingTestPluginDispatch/g) ?? []).length).toBe(2);
  });

  it("wires @WefterHook subscriptions onto the same constructed plugin instance used for dispatch", () => {
    const extraction = new Map<string, PluginExtraction>([
      [
        "device-info",
        {
          methods: [{ name: "getInfo", lineNumber: 5 }],
          hooks: [{ hookName: "onPause", methodName: "handlePause", lineNumber: 12 }],
        },
      ],
    ]);

    const kt = generateRegistryKotlin([deviceMock], "dev.wefter.bridge", extraction);

    expect(kt).toContain('dispatcher.subscribeHook("onPause") { deviceInfoPlugin.handlePause() }');
  });

  it("mixes legacy and new-pattern plugins correctly in the same registerAll", () => {
    const extraction = new Map<string, PluginExtraction>([
      ["device-info", { methods: [{ name: "getInfo", lineNumber: 5 }], hooks: [] }],
    ]);

    const kt = generateRegistryKotlin([deviceMock, pingMock], "dev.wefter.bridge", extraction);

    expect(kt).toContain("DeviceInfoPluginDispatch(deviceInfoPlugin)");
    expect(kt).toContain('dispatcher.register("ping-test", PingTestPlugin())');
    expect(kt).not.toContain("PingTestPluginDispatch");
  });
});
