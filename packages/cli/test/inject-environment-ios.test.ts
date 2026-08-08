import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectEnvironmentConfigIos } from "../src/native/inject-environment-ios.js";
import { iosShellTemplatePath } from "../src/native/shell-template.js";

const XCCONFIG_FIXTURE = `// WEFTER-ENV-CONFIG-START
PRODUCT_BUNDLE_IDENTIFIER = dev.wefter.bridge.dev
PRODUCT_NAME = Wefter (Dev)
// WEFTER-ENV-CONFIG-END
`;

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("injectEnvironmentConfigIos", () => {
  it("rewrites PRODUCT_BUNDLE_IDENTIFIER and PRODUCT_NAME between the markers", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-env-"));
    const xcconfigPath = join(dir, "Environment-development.xcconfig");
    writeFileSync(xcconfigPath, XCCONFIG_FIXTURE);

    injectEnvironmentConfigIos(xcconfigPath, { bundleId: "com.example.app.dev", appName: "Example (Dev)" });

    const result = readFileSync(xcconfigPath, "utf-8");
    expect(result).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.example.app.dev");
    expect(result).toContain("PRODUCT_NAME = Example (Dev)");
  });

  it("replaces the existing injected values on a second run instead of duplicating them", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-env-"));
    const xcconfigPath = join(dir, "Environment-development.xcconfig");
    writeFileSync(xcconfigPath, XCCONFIG_FIXTURE);

    injectEnvironmentConfigIos(xcconfigPath, { bundleId: "com.example.app.dev", appName: "Example (Dev)" });
    injectEnvironmentConfigIos(xcconfigPath, { bundleId: "com.example.app.dev2", appName: "Example (Dev 2)" });

    const result = readFileSync(xcconfigPath, "utf-8");
    expect(result).not.toContain("com.example.app.dev\n");
    expect(result).toContain("com.example.app.dev2");
    const markerCount = result.split("// WEFTER-ENV-CONFIG-START").length - 1;
    expect(markerCount).toBe(1);
  });

  it("throws clearly when the marker is missing entirely", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-env-"));
    const xcconfigPath = join(dir, "Environment-development.xcconfig");
    writeFileSync(xcconfigPath, "// no markers here\n");

    expect(() => injectEnvironmentConfigIos(xcconfigPath, { bundleId: "com.example.app", appName: "Example" })).toThrow(
      /WEFTER-ENV-CONFIG-START/,
    );
  });
});

describe("injectEnvironmentConfigIos against the real shell template", () => {
  it("rewrites the real shells/ios-template Environment-development.xcconfig", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-env-real-"));
    const xcconfigPath = join(dir, "Environment-development.xcconfig");
    cpSync(join(iosShellTemplatePath(), "Config/Environment-development.xcconfig"), xcconfigPath);

    injectEnvironmentConfigIos(xcconfigPath, { bundleId: "com.example.app.dev", appName: "Example (Dev)" });

    const result = readFileSync(xcconfigPath, "utf-8");
    expect(result).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.example.app.dev");
  });

  it("rewrites the real shells/ios-template Environment-production.xcconfig", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-ios-env-real-"));
    const xcconfigPath = join(dir, "Environment-production.xcconfig");
    cpSync(join(iosShellTemplatePath(), "Config/Environment-production.xcconfig"), xcconfigPath);

    injectEnvironmentConfigIos(xcconfigPath, { bundleId: "com.example.app", appName: "Example" });

    const result = readFileSync(xcconfigPath, "utf-8");
    expect(result).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.example.app");
  });
});
