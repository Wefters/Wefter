import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectNamespace, weaveAndroidNamespace, weaveJavaNamespace } from "../src/native/namespace.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("injectNamespace", () => {
  it("rewrites the template namespace declaration in build.gradle.kts", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-namespace-"));
    const gradlePath = join(dir, "build.gradle.kts");
    writeFileSync(gradlePath, 'android {\n    namespace = "dev.wefter.bridge"\n}\n');

    injectNamespace(gradlePath, "com.example.app");

    expect(readFileSync(gradlePath, "utf-8")).toContain('namespace = "com.example.app"');
  });

  it("throws clearly when the template declaration can't be found", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-namespace-"));
    const gradlePath = join(dir, "build.gradle.kts");
    writeFileSync(gradlePath, 'android {\n    namespace = "already.changed"\n}\n');

    expect(() => injectNamespace(gradlePath, "com.example.app")).toThrow(/template namespace/);
  });
});

function writeTemplateJavaTree(javaSrcRoot: string): void {
  const pkgDir = join(javaSrcRoot, "dev/wefter/bridge");
  mkdirSync(join(pkgDir, "plugins"), { recursive: true });
  writeFileSync(join(pkgDir, "MainActivity.kt"), "package dev.wefter.bridge\n\nclass MainActivity\n");
  writeFileSync(join(pkgDir, "plugins/DeviceInfoPlugin.kt"), "package dev.wefter.bridge\n\nclass DeviceInfoPlugin\n");
}

describe("weaveJavaNamespace", () => {
  it("rewrites package declarations in place and leaves the path alone when the namespace is unchanged", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-namespace-"));
    writeTemplateJavaTree(dir);

    weaveJavaNamespace(dir, "dev.wefter.bridge");

    expect(readFileSync(join(dir, "dev/wefter/bridge/MainActivity.kt"), "utf-8")).toContain(
      "package dev.wefter.bridge",
    );
  });

  it("moves the source tree to an unrelated namespace and rewrites every package line", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-namespace-"));
    writeTemplateJavaTree(dir);

    weaveJavaNamespace(dir, "com.example.app");

    expect(existsSync(join(dir, "dev"))).toBe(false);
    expect(readFileSync(join(dir, "com/example/app/MainActivity.kt"), "utf-8")).toContain("package com.example.app");
    expect(readFileSync(join(dir, "com/example/app/plugins/DeviceInfoPlugin.kt"), "utf-8")).toContain(
      "package com.example.app",
    );
  });

  it("handles a namespace that nests right inside the template path (dev.wefter.bridge.demo)", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-namespace-"));
    writeTemplateJavaTree(dir);

    weaveJavaNamespace(dir, "dev.wefter.bridge.demo");

    expect(existsSync(join(dir, "dev/wefter/bridge/demo/MainActivity.kt"))).toBe(true);
    expect(readFileSync(join(dir, "dev/wefter/bridge/demo/MainActivity.kt"), "utf-8")).toContain(
      "package dev.wefter.bridge.demo",
    );
    expect(readFileSync(join(dir, "dev/wefter/bridge/demo/plugins/DeviceInfoPlugin.kt"), "utf-8")).toContain(
      "package dev.wefter.bridge.demo",
    );
  });

  it("handles a namespace that's a shorter ancestor of the template path (dev.wefter)", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-namespace-"));
    writeTemplateJavaTree(dir);

    weaveJavaNamespace(dir, "dev.wefter");

    expect(existsSync(join(dir, "dev/wefter/MainActivity.kt"))).toBe(true);
    expect(existsSync(join(dir, "dev/wefter/bridge"))).toBe(false);
    expect(readFileSync(join(dir, "dev/wefter/MainActivity.kt"), "utf-8")).toContain("package dev.wefter");
  });
});

describe("weaveAndroidNamespace", () => {
  it("applies the rewrite to every java/ source root (src/main and src/test alike)", () => {
    dir = mkdtempSync(join(tmpdir(), "wefter-namespace-"));
    writeTemplateJavaTree(join(dir, "src/main/java"));
    writeTemplateJavaTree(join(dir, "src/test/java"));
    mkdirSync(join(dir, "src/debug/res"), { recursive: true });

    weaveAndroidNamespace(dir, "com.example.app");

    expect(existsSync(join(dir, "src/main/java/com/example/app/MainActivity.kt"))).toBe(true);
    expect(existsSync(join(dir, "src/test/java/com/example/app/MainActivity.kt"))).toBe(true);
  });
});
