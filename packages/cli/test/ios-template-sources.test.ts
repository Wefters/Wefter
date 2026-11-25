import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const templateDir = join(dirname(fileURLToPath(import.meta.url)), "../../../shells/ios-template");

describe("iOS shell template", () => {
  it("compiles every top-level Swift file in WefterBridge/", () => {
    const pbxproj = readFileSync(join(templateDir, "WefterBridge.xcodeproj/project.pbxproj"), "utf-8");
    const swiftFiles = readdirSync(join(templateDir, "WefterBridge")).filter((f) => f.endsWith(".swift"));

    expect(swiftFiles.length).toBeGreaterThan(0);
    const missing = swiftFiles.filter((f) => !pbxproj.includes(`/* ${f} in Sources */`));
    expect(missing).toEqual([]);
  });
});
