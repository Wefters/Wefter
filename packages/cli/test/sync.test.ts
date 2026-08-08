import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { sync } from "../src/commands/sync.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const brokenProjectFixtureDir = join(fixturesDir, "broken-project");
const fixtureTestProjectDir = join(fixturesDir, "test-project");

let projectDir: string;
let generatedFile: string;
let pluginSourceDir: string;
let buildGradlePath: string;
let manifestPath: string;
let webAssetsDir: string;
let proguardRulesPath: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "wefter-sync-"));
  cpSync(join(fixtureTestProjectDir, "plugins"), join(projectDir, "plugins"), { recursive: true });
  cpSync(join(fixtureTestProjectDir, "wefter.config.json"), join(projectDir, "wefter.config.json"));
  cpSync(join(fixtureTestProjectDir, "web"), join(projectDir, "web"), { recursive: true });

  const appDir = join(projectDir, ".wefter/native/android/app");
  
  
  generatedFile = join(appDir, "src/main/java/com/example/app/GeneratedRegistry.kt");
  pluginSourceDir = join(appDir, "src/main/java/com/example/app/plugins");
  buildGradlePath = join(appDir, "build.gradle.kts");
  manifestPath = join(appDir, "src/main/AndroidManifest.xml");
  webAssetsDir = join(appDir, "src/main/assets/www");
  proguardRulesPath = join(appDir, "proguard-rules.pro");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("sync", () => {
  it("discovers both fixture plugins, sorted, and writes the generated registry to disk", async () => {
    const result = await sync(projectDir);

    expect(result.plugins).toEqual(["device-info", "ping-test"]);
    expect(result.outFile).toBe(generatedFile);
    expect(existsSync(generatedFile)).toBe(true);

    const contents = readFileSync(generatedFile, "utf-8");
    expect(contents).toContain('dispatcher.register("device-info", DeviceInfoPlugin())');
    expect(contents).toContain('dispatcher.register("ping-test", PingTestPlugin())');
  });

  it("weaves native source: copies both plugins' .kt files into the plugin source dir", async () => {
    await sync(projectDir);

    expect(readdirSync(pluginSourceDir).sort()).toEqual(["DeviceInfoPlugin.kt", "PingTestPlugin.kt"]);
  });

  it("merges the gradle dependency declared by ping-test into the marker block", async () => {
    const result = await sync(projectDir);

    expect(result.gradleDepsAdded).toEqual(["com.example:ping-lib:1.0.0"]);
    const gradle = readFileSync(buildGradlePath, "utf-8");
    expect(gradle).toContain('implementation("com.example:ping-lib:1.0.0")');
  });

  it("merges the permission declared by device-info into the marker block", async () => {
    const result = await sync(projectDir);

    expect(result.permissionsAdded).toEqual(["android.permission.INTERNET"]);
    const manifest = readFileSync(manifestPath, "utf-8");
    expect(manifest).toContain('<uses-permission android:name="android.permission.INTERNET" />');
  });

  it("merges the proguard rule declared by ping-test into proguard-rules.pro", async () => {
    const result = await sync(projectDir);

    expect(result.proguardRulesAdded).toEqual(["-keep class com.example.pinglib.** { *; }"]);
    const proguard = readFileSync(proguardRulesPath, "utf-8");
    expect(proguard).toContain("-keep class com.example.pinglib.** { *; }");
  });

  it("injects applicationId/appName for every configured environment", async () => {
    const result = await sync(projectDir);

    expect(result.environments.sort()).toEqual(["development", "production"]);
    const gradle = readFileSync(buildGradlePath, "utf-8");
    expect(gradle).toContain('applicationId = "com.example.app.dev"');
    expect(gradle).toContain('applicationId = "com.example.app"');
    expect(gradle).toContain('resValue("string", "app_name", "Example (Dev)")');
  });

  it("copies web assets from the configured webDir into the android assets folder", async () => {
    const result = await sync(projectDir);

    expect(result.webAssetsDir).toBe(webAssetsDir);
    expect(readFileSync(join(webAssetsDir, "index.html"), "utf-8")).toContain("Test project");
    expect(readFileSync(join(webAssetsDir, "main.js"), "utf-8")).toContain("test project web asset");
  });

  it("is idempotent — running twice with no plugin changes produces byte-identical registry output", async () => {
    await sync(projectDir);
    const first = readFileSync(generatedFile, "utf-8");

    await sync(projectDir);
    const second = readFileSync(generatedFile, "utf-8");

    expect(second).toBe(first);
  });

  it("removes a plugin's woven source and merged deps when it's no longer installed", async () => {
    await sync(projectDir);
    expect(readdirSync(pluginSourceDir).sort()).toEqual(["DeviceInfoPlugin.kt", "PingTestPlugin.kt"]);

    rmSync(join(projectDir, "plugins/ping-test"), { recursive: true, force: true });
    const result = await sync(projectDir);

    expect(result.plugins).toEqual(["device-info"]);
    expect(readdirSync(pluginSourceDir)).toEqual(["DeviceInfoPlugin.kt"]);
    expect(result.gradleDepsAdded).toEqual([]);
    const gradle = readFileSync(buildGradlePath, "utf-8");
    expect(gradle).not.toContain("ping-lib");
    const registry = readFileSync(generatedFile, "utf-8");
    expect(registry).not.toContain("PingTestPlugin");
  });

  it("throws with the offending package name when a plugin manifest is invalid, and never touches the checked-in fixture", async () => {
    const brokenDir = mkdtempSync(join(tmpdir(), "wefter-broken-"));
    cpSync(join(brokenProjectFixtureDir, "plugins"), join(brokenDir, "node_modules"), { recursive: true });
    writeFileSync(
      join(brokenDir, "wefter.config.json"),
      JSON.stringify({
        environments: { production: { appId: "com.example.app", appName: "Example" } },
        plugins: ["bad-plugin"],
      }),
    );

    try {
      await expect(sync(brokenDir)).rejects.toThrow(/bad-plugin/);
      expect(existsSync(join(brokenProjectFixtureDir, ".wefter"))).toBe(false);
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  });

  it("preserves app/build and .gradle across a re-sync — Gradle output for another flavor isn't wiped out", async () => {
    await sync(projectDir);

    const appDir = join(projectDir, ".wefter/native/android/app");
    const staleApk = join(appDir, "build/outputs/apk/production/debug/app-production-debug.apk");
    const gradleCache = join(projectDir, ".wefter/native/android/.gradle/cache-marker");
    mkdirSync(dirname(staleApk), { recursive: true });
    writeFileSync(staleApk, "fake apk bytes");
    mkdirSync(dirname(gradleCache), { recursive: true });
    writeFileSync(gradleCache, "fake gradle cache");

    await sync(projectDir);

    expect(existsSync(staleApk)).toBe(true);
    expect(existsSync(gradleCache)).toBe(true);
    expect(existsSync(generatedFile)).toBe(true);
  });

  it("recovers cleanly on the next run after a failed sync — no manual cleanup needed", async () => {
    writeFileSync(join(projectDir, "plugins/device-info/plugin.json"), "{ invalid");

    await expect(sync(projectDir)).rejects.toThrow();

    writeFileSync(
      join(projectDir, "plugins/device-info/plugin.json"),
      JSON.stringify({ name: "device-info", permissions: { android: ["android.permission.INTERNET"] } })
    );
    const result = await sync(projectDir);

    expect(result.plugins).toEqual(["device-info", "ping-test"]);
  });
});

describe("sync — plugin registry", () => {
  it("uses exactly the registered list from wefter.config.json, not everything installed", async () => {
    const rawConfig = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({ ...rawConfig, plugins: ["device-info"] }, null, 2)
    );

    const result = await sync(projectDir);

    expect(result.plugins).toEqual(["device-info"]);
    expect(readdirSync(pluginSourceDir)).toEqual(["DeviceInfoPlugin.kt"]);
  });

  it("ignores a plugin sitting in node_modules that isn't declared in wefter.config.json", async () => {
    const rawConfig = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({ ...rawConfig, plugins: ["device-info"] }, null, 2)
    );

    const result = await sync(projectDir);

    
    expect(result.plugins).toEqual(["device-info"]);
  });

  it("surfaces a declared plugin that's no longer installed instead of silently building without it", async () => {
    const rawConfig = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8"));
    writeFileSync(
      join(projectDir, "wefter.config.json"),
      JSON.stringify({ ...rawConfig, plugins: ["device-info", "removed-plugin"] }, null, 2)
    );

    const result = await sync(projectDir);

    expect(result.plugins).toEqual(["device-info"]);
    expect(result.unresolvedRegisteredPlugins).toEqual(["removed-plugin"]);
  });

  it("never writes to the plugins field of wefter.config.json — declaration is the developer's alone", async () => {
    const before = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8")).plugins;

    await sync(projectDir);

    const after = JSON.parse(readFileSync(join(projectDir, "wefter.config.json"), "utf-8")).plugins;
    expect(after).toEqual(before);
  });
});

describe("sync — permission audit", () => {
  it("throws when a plugin's Kotlin source uses a sensitive API without declaring the matching permission", async () => {
    writeFileSync(
      join(projectDir, "plugins/device-info/android/Extra.kt"),
      "package dev.wefter.bridge\n\nimport androidx.camera.core.CameraX\n\nclass Extra\n"
    );

    await expect(sync(projectDir)).rejects.toThrow(/CameraX.*android\.permission\.CAMERA/s);
  });
});

describe("sync — @WefterMethod extraction and consistency audit", () => {
  it("generates a Dispatch wrapper and registers it when a plugin uses @WefterMethod", async () => {
    writeFileSync(
      join(projectDir, "plugins/device-info/android/DeviceInfoPlugin.kt"),
      [
        "package dev.wefter.bridge",
        "",
        "import org.json.JSONObject",
        "",
        "class DeviceInfoPlugin(context: android.content.Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher) {",
        "    @WefterMethod",
        "    fun getInfo(payload: JSONObject, callback: (Result<Any>) -> Unit) {",
        "        resolve(callback)",
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    await sync(projectDir);

    const generated = readFileSync(generatedFile, "utf-8");
    expect(generated).toContain("class DeviceInfoPluginDispatch(private val plugin: DeviceInfoPlugin) : NativeModule");
    expect(generated).toContain("val deviceInfoPlugin = DeviceInfoPlugin(context, dispatcher)");
    expect(generated).toContain("DeviceInfoPluginDispatch(deviceInfoPlugin)");
  });

  it("throws with the plugin name and line number for a malformed @WefterMethod signature", async () => {
    writeFileSync(
      join(projectDir, "plugins/device-info/android/DeviceInfoPlugin.kt"),
      [
        "package dev.wefter.bridge",
        "",
        "class DeviceInfoPlugin {",
        "    @WefterMethod",
        "    fun getInfo(wrongParam: String) {",
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    await expect(sync(projectDir)).rejects.toThrow(/device-info.*malformed @WefterMethod.*line/is);
  });

  it("throws when plugin.json's declared methods don't match the extracted @WefterMethod set", async () => {
    writeFileSync(
      join(projectDir, "plugins/device-info/plugin.json"),
      JSON.stringify({ name: "device-info", methods: ["getInfo", "somethingElse"] }),
    );
    writeFileSync(
      join(projectDir, "plugins/device-info/android/DeviceInfoPlugin.kt"),
      [
        "package dev.wefter.bridge",
        "",
        "import org.json.JSONObject",
        "",
        "class DeviceInfoPlugin(context: android.content.Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher) {",
        "    @WefterMethod",
        "    fun getInfo(payload: JSONObject, callback: (Result<Any>) -> Unit) {",
        "        resolve(callback)",
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    await expect(sync(projectDir)).rejects.toThrow(/device-info.*somethingElse/s);
  });
});

describe("sync — lockfile", () => {
  it("writes wefter.lock.json with an entry per synced plugin", async () => {
    await sync(projectDir);

    const lock = JSON.parse(readFileSync(join(projectDir, "wefter.lock.json"), "utf-8"));
    expect(Object.keys(lock.plugins).sort()).toEqual(["device-info", "ping-test"]);
    expect(lock.plugins["device-info"].integrity).toMatch(/^sha256-/);
  });

  it("blocks a re-sync when an installed plugin's version drifted from the lockfile, without --update-lock", async () => {
    await sync(projectDir);
    writeFileSync(
      join(projectDir, "plugins/device-info/package.json"),
      JSON.stringify({ name: "device-info", version: "9.9.9" })
    );

    await expect(sync(projectDir)).rejects.toThrow(/drift/i);
  });

  it("accepts drifted versions and re-locks when --update-lock is passed", async () => {
    await sync(projectDir);
    writeFileSync(
      join(projectDir, "plugins/device-info/package.json"),
      JSON.stringify({ name: "device-info", version: "9.9.9" })
    );

    const result = await sync(projectDir, { updateLock: true });
    expect(result.plugins).toContain("device-info");

    const lock = JSON.parse(readFileSync(join(projectDir, "wefter.lock.json"), "utf-8"));
    expect(lock.plugins["device-info"].resolved).toBe("9.9.9");
  });
});

describe("sync — freshness marker", () => {
  it("writes a .wefter/.sync-marker after a successful sync", async () => {
    await sync(projectDir);

    expect(existsSync(join(projectDir, ".wefter/.sync-marker"))).toBe(true);
  });
});

describe("sync — iOS", () => {
  let iosAppDir: string;

  beforeEach(() => {
    iosAppDir = join(projectDir, ".wefter/native/ios/WefterBridge");
  });

  it("recreates the iOS shell alongside the Android one — Xcode project and GeneratedRegistry.swift both exist", async () => {
    await sync(projectDir);

    expect(existsSync(join(projectDir, ".wefter/native/ios/WefterBridge.xcodeproj"))).toBe(true);
    expect(existsSync(join(iosAppDir, "GeneratedRegistry.swift"))).toBe(true);
  });

  it("copies the same web assets into the iOS www dir as the Android assets dir", async () => {
    const result = await sync(projectDir);

    expect(readFileSync(join(result.iosWebAssetsDir, "index.html"), "utf-8")).toContain("Test project");
    expect(readFileSync(join(result.iosWebAssetsDir, "main.js"), "utf-8")).toContain("test project web asset");
  });

  it("injects PRODUCT_BUNDLE_IDENTIFIER for every configured environment", async () => {
    await sync(projectDir);

    const devXcconfig = readFileSync(join(projectDir, ".wefter/native/ios/Config/Environment-development.xcconfig"), "utf-8");
    const prodXcconfig = readFileSync(join(projectDir, ".wefter/native/ios/Config/Environment-production.xcconfig"), "utf-8");
    expect(devXcconfig).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.example.app.dev");
    expect(prodXcconfig).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.example.app");
  });

  it("neither fixture plugin ships ios/ source, so nothing is woven and the registry stays empty of them", async () => {
    const result = await sync(projectDir);

    expect(result.iosPluginsWithNativeSource).toEqual([]);
    expect(readdirSync(join(iosAppDir, "Plugins"))).toEqual([]);
    const registry = readFileSync(join(iosAppDir, "GeneratedRegistry.swift"), "utf-8");
    expect(registry).not.toContain("DeviceInfoPlugin(dispatcher");
  });

  it("weaves a plugin's ios/ source when present and registers it in GeneratedRegistry.swift", async () => {
    mkdirSync(join(projectDir, "plugins/device-info/ios"), { recursive: true });
    writeFileSync(
      join(projectDir, "plugins/device-info/ios/DeviceInfoPlugin.swift"),
      [
        "import Foundation",
        "",
        "final class DeviceInfoPlugin: WefterPlugin {",
        "    // @WefterMethod",
        "    func getInfo(payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {",
        "        resolve(callback)",
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    const result = await sync(projectDir);

    expect(result.iosPluginsWithNativeSource).toEqual(["device-info"]);
    expect(readdirSync(join(iosAppDir, "Plugins"))).toEqual(["DeviceInfoPlugin.swift"]);
    const registry = readFileSync(join(iosAppDir, "GeneratedRegistry.swift"), "utf-8");
    expect(registry).toContain("final class DeviceInfoPluginDispatch: NativeModule");
    expect(registry).toContain('case "getInfo":');
    expect(registry).toContain("let deviceInfoPlugin = DeviceInfoPlugin(dispatcher: dispatcher, viewController: viewController)");
  });

  it("removes a plugin's woven iOS source when it's no longer installed, same as the Android side", async () => {
    mkdirSync(join(projectDir, "plugins/device-info/ios"), { recursive: true });
    writeFileSync(
      join(projectDir, "plugins/device-info/ios/DeviceInfoPlugin.swift"),
      "import Foundation\nfinal class DeviceInfoPlugin: WefterPlugin {}\n",
    );
    await sync(projectDir);
    expect(readdirSync(join(iosAppDir, "Plugins"))).toEqual(["DeviceInfoPlugin.swift"]);

    rmSync(join(projectDir, "plugins/device-info/ios"), { recursive: true, force: true });
    const result = await sync(projectDir);

    expect(result.iosPluginsWithNativeSource).toEqual([]);
    expect(readdirSync(join(iosAppDir, "Plugins"))).toEqual([]);
  });

  it("is idempotent — running twice with no plugin changes produces byte-identical GeneratedRegistry.swift", async () => {
    await sync(projectDir);
    const first = readFileSync(join(iosAppDir, "GeneratedRegistry.swift"), "utf-8");

    await sync(projectDir);
    const second = readFileSync(join(iosAppDir, "GeneratedRegistry.swift"), "utf-8");

    expect(second).toBe(first);
  });

  it("preserves the iOS build/ derived-data dir across a re-sync, same as Android's app/build", async () => {
    await sync(projectDir);

    const staleBuildArtifact = join(projectDir, ".wefter/native/ios/build/Build/Products/marker.txt");
    mkdirSync(dirname(staleBuildArtifact), { recursive: true });
    writeFileSync(staleBuildArtifact, "fake derived data");

    await sync(projectDir);

    expect(existsSync(staleBuildArtifact)).toBe(true);
  });

  it("an Android-only plugin doesn't break iOS registry generation (the legacy-fallback bug this wiring had to avoid)", async () => {
    
    
    const result = await sync(projectDir);

    expect(result.plugins).toEqual(["device-info", "ping-test"]);
    const registry = readFileSync(join(iosAppDir, "GeneratedRegistry.swift"), "utf-8");
    expect(registry).toContain("enum GeneratedRegistry");
  });
});

