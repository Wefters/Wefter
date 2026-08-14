import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { iosShellTemplatePath, shellTemplatePath } from "../src/native/shell-template.js";

describe("shellTemplatePath", () => {
  it("resolves an existing android-template directory", () => {
    const path = shellTemplatePath();
    expect(existsSync(path)).toBe(true);
    expect(path).toContain("android-template");
  });

  it("resolves an existing ios-template directory", () => {
    const path = iosShellTemplatePath();
    expect(existsSync(path)).toBe(true);
    expect(path).toContain("ios-template");
  });
});
