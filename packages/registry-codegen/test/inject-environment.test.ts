import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectEnvironmentConfig } from "../src/inject-environment.js";

const BUILD_GRADLE_FIXTURE = `android {
    flavorDimensions += "environment"
    productFlavors {
        create("development") {
            dimension = "environment"
            // WEFTER-ENV-CONFIG-START

            // WEFTER-ENV-CONFIG-END
        }
        create("production") {
            dimension = "environment"
            // WEFTER-ENV-CONFIG-START

            // WEFTER-ENV-CONFIG-END
        }
    }
}
`;

let tmpDir: string;
let gradlePath: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("injectEnvironmentConfig", () => {
  it("injects applicationId and app_name resValue into the matching flavor's block only", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-env-"));
    gradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(gradlePath, BUILD_GRADLE_FIXTURE);

    injectEnvironmentConfig(gradlePath, "development", { appId: "com.example.app.dev", appName: "Example (Dev)" });

    const result = readFileSync(gradlePath, "utf-8");
    expect(result).toContain('applicationId = "com.example.app.dev"');
    expect(result).toContain('resValue("string", "app_name", "Example (Dev)")');

    const productionBlock = result.slice(result.indexOf('create("production")'));
    expect(productionBlock).not.toContain("com.example.app.dev");
  });

  it("injects both flavors independently without cross-contamination", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-env-"));
    gradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(gradlePath, BUILD_GRADLE_FIXTURE);

    injectEnvironmentConfig(gradlePath, "development", { appId: "com.example.app.dev", appName: "Example (Dev)" });
    injectEnvironmentConfig(gradlePath, "production", { appId: "com.example.app", appName: "Example" });

    const result = readFileSync(gradlePath, "utf-8");
    expect(result).toContain('applicationId = "com.example.app.dev"');
    expect(result).toContain('applicationId = "com.example.app"');
  });

  it("replaces the existing injected values on a second run instead of duplicating them", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-env-"));
    gradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(gradlePath, BUILD_GRADLE_FIXTURE);

    injectEnvironmentConfig(gradlePath, "development", { appId: "com.example.app.dev", appName: "Example (Dev)" });
    injectEnvironmentConfig(gradlePath, "development", { appId: "com.example.app.dev2", appName: "Example (Dev 2)" });

    const result = readFileSync(gradlePath, "utf-8");
    expect(result).not.toContain('com.example.app.dev"');
    expect(result).toContain('applicationId = "com.example.app.dev2"');
    const markerCount = result.split("// WEFTER-ENV-CONFIG-START").length - 1;
    expect(markerCount).toBe(2);
  });

  it("throws clearly when the requested flavor doesn't exist", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wefter-env-"));
    gradlePath = join(tmpDir, "build.gradle.kts");
    writeFileSync(gradlePath, BUILD_GRADLE_FIXTURE);

    expect(() =>
      injectEnvironmentConfig(gradlePath, "staging", { appId: "com.example.app.staging", appName: "Staging" }),
    ).toThrow(/staging/);
  });
});
