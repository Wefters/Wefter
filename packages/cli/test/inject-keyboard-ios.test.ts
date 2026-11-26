import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { injectKeyboardConfigIos } from "../src/native/inject-keyboard-ios.js";
import { WefterConfigSchema } from "../src/config/wefter-config-schema.js";

const templateBuildConfig = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../shells/ios-template/WefterBridge/BuildConfig.swift"),
  "utf-8",
);

describe("injectKeyboardConfigIos", () => {
  let tmpDir: string;
  let buildConfigPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-keyboard-ios-"));
    buildConfigPath = join(tmpDir, "BuildConfig.swift");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("hides the bar by default in the template", () => {
    expect(templateBuildConfig).toContain("static let formAccessoryBar = false");
  });

  it("writes the setting between the markers and can switch it back", () => {
    writeFileSync(buildConfigPath, templateBuildConfig);

    injectKeyboardConfigIos(buildConfigPath, true);
    expect(readFileSync(buildConfigPath, "utf-8")).toContain("static let formAccessoryBar = true");

    injectKeyboardConfigIos(buildConfigPath, false);
    const result = readFileSync(buildConfigPath, "utf-8");
    expect(result).toContain("static let formAccessoryBar = false");
    expect(result.match(/formAccessoryBar/g)).toHaveLength(1);
  });

  it("adds the markers inside BuildConfig in projects that predate them", () => {
    writeFileSync(buildConfigPath, "enum BuildConfig {\n    static let landscape = false\n}\n");

    injectKeyboardConfigIos(buildConfigPath, true);
    injectKeyboardConfigIos(buildConfigPath, true);

    const result = readFileSync(buildConfigPath, "utf-8");
    expect(result).toBe(
      "enum BuildConfig {\n    static let landscape = false\n\n" +
        "    // WEFTER-KEYBOARD-CONFIG-START\n    static let formAccessoryBar = true\n    // WEFTER-KEYBOARD-CONFIG-END\n}\n",
    );
  });
});

describe("keyboard config", () => {
  const base = { environments: { development: { appId: "com.example.app", appName: "App" } } };

  it("is optional", () => {
    expect(WefterConfigSchema.parse(base).keyboard).toBeUndefined();
  });

  it("accepts accessoryBar and rejects other types", () => {
    expect(WefterConfigSchema.parse({ ...base, keyboard: { accessoryBar: true } }).keyboard).toEqual({
      accessoryBar: true,
    });
    expect(WefterConfigSchema.safeParse({ ...base, keyboard: { accessoryBar: "yes" } }).success).toBe(false);
  });
});
