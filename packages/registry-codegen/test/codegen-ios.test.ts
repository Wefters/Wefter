import { describe, expect, it, test } from "vitest";
import { generateRegistrySwift, type PluginExtractionSwift } from "../src/codegen-ios.js";
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

describe("generateRegistrySwift", () => {
  it("skips a discovered plugin that has no extraction entry — no ios/ folder means no iOS registration", () => {
    const swift = generateRegistrySwift([deviceMock, pingMock], new Map());

    expect(swift).not.toContain("DeviceInfoPlugin(");
    expect(swift).not.toContain("PingTestPlugin(");
    expect(swift).toContain("enum GeneratedRegistry");
  });

  it("produces exactly one registerAll on GeneratedRegistry, taking a BridgeDispatcher and UIViewController", () => {
    const extraction = new Map<string, PluginExtractionSwift>([
      ["device-info", { methods: [{ name: "getInfo", lineNumber: 5 }], hooks: [] }],
    ]);

    const swift = generateRegistrySwift([deviceMock], extraction);

    expect(swift).toContain("enum GeneratedRegistry");
    expect(swift).toContain("static func registerAll(dispatcher: BridgeDispatcher, viewController: UIViewController)");
    expect(swift).toContain("import UIKit");
  });

  it("declares a Dispatch class conforming to NativeModule, constructs the plugin with (dispatcher, viewController)", () => {
    const extraction = new Map<string, PluginExtractionSwift>([
      ["device-info", { methods: [{ name: "getInfo", lineNumber: 5 }], hooks: [] }],
    ]);

    const swift = generateRegistrySwift([deviceMock], extraction);

    expect(swift).toContain("final class DeviceInfoPluginDispatch: NativeModule {");
    expect(swift).toContain('case "getInfo":');
    expect(swift).toContain("try plugin.getInfo(payload: payload, callback: callback)");
    expect(swift).toContain('callback(.failure(WefterError(code: "UNKNOWN_METHOD", message: "No such method: \\(method)")))');
    expect(swift).toContain("let deviceInfoPlugin = DeviceInfoPlugin(dispatcher: dispatcher, viewController: viewController)");
    expect(swift).toContain('dispatcher.register("device-info", module: DeviceInfoPluginDispatch(plugin: deviceInfoPlugin))');
  });

  it("every method gets its own switch-case, all on the same instance", () => {
    const extraction = new Map<string, PluginExtractionSwift>([
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

    const swift = generateRegistrySwift([pingMock], extraction);

    expect(swift).toContain('case "ping":');
    expect(swift).toContain('case "reset":');
    expect((swift.match(/PingTestPluginDispatch/g) ?? []).length).toBe(2); 
  });

  it("wires @WefterHook subscriptions onto the same constructed plugin instance used for dispatch", () => {
    const extraction = new Map<string, PluginExtractionSwift>([
      [
        "device-info",
        {
          methods: [{ name: "getInfo", lineNumber: 5 }],
          hooks: [{ hookName: "onPause", methodName: "handlePause", lineNumber: 12 }],
        },
      ],
    ]);

    const swift = generateRegistrySwift([deviceMock], extraction);

    expect(swift).toContain('dispatcher.subscribeHook("onPause") { deviceInfoPlugin.handlePause() }');
  });

  test("regenerating with fewer plugins removes stale registrations", () => {
    const extraction = new Map<string, PluginExtractionSwift>([
      ["device-info", { methods: [{ name: "getInfo", lineNumber: 5 }], hooks: [] }],
      ["ping-test", { methods: [{ name: "ping", lineNumber: 3 }], hooks: [] }],
    ]);

    const withTwo = generateRegistrySwift([deviceMock, pingMock], extraction);
    const withOne = generateRegistrySwift([deviceMock], extraction);

    expect(withTwo).toContain("PingTestPluginDispatch");
    expect(withOne).not.toContain("PingTestPluginDispatch");
  });

  test("running generateRegistrySwift twice with no changes produces identical output", () => {
    const extraction = new Map<string, PluginExtractionSwift>([
      ["device-info", { methods: [{ name: "getInfo", lineNumber: 5 }], hooks: [] }],
    ]);

    const first = generateRegistrySwift([deviceMock], extraction);
    const second = generateRegistrySwift([deviceMock], extraction);

    expect(first).toBe(second);
  });

  it("mixes plugins with and without iOS extraction correctly in the same registerAll", () => {
    const extraction = new Map<string, PluginExtractionSwift>([
      ["device-info", { methods: [{ name: "getInfo", lineNumber: 5 }], hooks: [] }],
    ]);

    const swift = generateRegistrySwift([deviceMock, pingMock], extraction);

    expect(swift).toContain("DeviceInfoPluginDispatch(plugin: deviceInfoPlugin)");
    expect(swift).not.toContain("PingTestPlugin");
  });
});
