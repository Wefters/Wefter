import { describe, expect, it } from "vitest";
import { generateNativeDependenciesPackage } from "../src/generate-native-dependencies-package.js";
import type { DiscoveredPlugin } from "../src/scan-plugins.js";

function pluginWithSpm(
  name: string,
  spm?: { url: string; from: string; product: string }[],
): DiscoveredPlugin {
  return {
    packageDir: `/fake/${name}`,
    manifest: {
      name,
      permissions: { android: [], ios: {} },
      nativeDependencies: spm ? { ios: { spm } } : {},
      hooks: [],
      events: [],
      methods: [],
    },
  };
}

describe("generateNativeDependenciesPackage", () => {
  it("produces a valid-shaped Package.swift header with no dependencies when none are declared", () => {
    const swift = generateNativeDependenciesPackage([pluginWithSpm("plain")]);

    expect(swift).toContain("// swift-tools-version:5.9");
    expect(swift).toContain('name: "NativeDependencies"');
    expect(swift).toContain("dependencies: [");
    expect(swift).toContain("targets: [");
  });

  it("adds a .package(url:from:) line for a declared SPM dependency", () => {
    const swift = generateNativeDependenciesPackage([
      pluginWithSpm("scanner", [{ url: "https://github.com/example/CodeScanner", from: "2.1.0", product: "CodeScanner" }]),
    ]);

    expect(swift).toContain('.package(url: "https://github.com/example/CodeScanner", from: "2.1.0"),');
    expect(swift).toContain('.product(name: "CodeScanner", package: "CodeScanner"),');
  });

  it("derives package identity from the URL, stripping a trailing .git", () => {
    const swift = generateNativeDependenciesPackage([
      pluginWithSpm("scanner", [{ url: "https://github.com/example/CodeScanner.git", from: "2.1.0", product: "CodeScanner" }]),
    ]);

    expect(swift).toContain('.product(name: "CodeScanner", package: "CodeScanner"),');
    
    
    expect(swift).not.toContain('package: "CodeScanner.git"');
  });

  it("de-duplicates an identical package URL requested by two different plugins", () => {
    const swift = generateNativeDependenciesPackage([
      pluginWithSpm("scanner", [{ url: "https://github.com/example/Shared", from: "1.0.0", product: "Shared" }]),
      pluginWithSpm("other", [{ url: "https://github.com/example/Shared", from: "1.0.0", product: "Shared" }]),
    ]);

    const packageLineCount = (swift.match(/\.package\(url: "https:\/\/github\.com\/example\/Shared"/g) ?? []).length;
    expect(packageLineCount).toBe(1);
  });

  it("removing a plugin's dependency on regeneration removes its lines — full regen, not additive", () => {
    const withDep = generateNativeDependenciesPackage([
      pluginWithSpm("scanner", [{ url: "https://github.com/example/CodeScanner", from: "2.1.0", product: "CodeScanner" }]),
    ]);
    const withoutDep = generateNativeDependenciesPackage([pluginWithSpm("scanner")]);

    expect(withDep).toContain("CodeScanner");
    expect(withoutDep).not.toContain("CodeScanner");
  });

  it("running twice with identical input produces byte-identical output", () => {
    const plugins = [
      pluginWithSpm("scanner", [{ url: "https://github.com/example/CodeScanner", from: "2.1.0", product: "CodeScanner" }]),
    ];

    expect(generateNativeDependenciesPackage(plugins)).toBe(generateNativeDependenciesPackage(plugins));
  });
});
