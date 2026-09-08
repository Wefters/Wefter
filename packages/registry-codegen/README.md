<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../Logo/Dark/Icon.svg">
    <source media="(prefers-color-scheme: light)" srcset="../../Logo/Light/Icon.svg">
    <img alt="Wefter" src="../../Logo/Light/Icon.svg" width="72">
  </picture>

  <h1>@wefterjs/registry-codegen</h1>
  <p><strong>Code generation and native project weaving engine for Wefter.</strong></p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-0.0.1-blue?style=flat-square">
    <a href="../../LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  </p>

  <p>
    <a href="https://wefter.dev/cli"><strong>Documentation</strong></a> ·
    <a href="https://github.com/Wefters/Wefter">Wefter monorepo</a> ·
    <a href="https://discord.gg/wefter">Discord</a>
  </p>
</div>

---

`@wefterjs/registry-codegen` is the internal engine driven by `@wefterjs/cli` during `wefter sync`, `wefter audit`, and `wefter plugin validate`. It discovers installed plugins, validates their schemas, parses native source code, merges build specifications, and generates typed routing registries for Android and iOS.

## Overview

Wefter avoids runtime reflection when routing bridge calls to native Kotlin or Swift classes. Instead, this engine reads the annotations and method signatures declared by plugins during build time and emits static dispatch code (`GeneratedRegistry.kt` and `GeneratedRegistry.swift`). This approach preserves compile-time safety and prevents runtime dispatch overhead.

## Core modules

### Plugin scanning and validation

- `scanPlugins`: Traverses `node_modules` or a designated plugins directory to discover packages containing a valid `plugin.json` manifest.
- `validatePluginDirectory`: Verifies that a plugin conforms to required conventions, checking that declared methods exist in native source files and that required permissions are documented.
- `PluginManifestSchema`: Zod schema specifying valid manifest fields including permissions, methods, hooks, Android Gradle dependencies, and iOS CocoaPods or Swift Package Manager configurations.

### Native source parsing

- `extractWefterMethods` and `extractWefterHooks`: Scans Kotlin sources for `@WefterMethod` and `@WefterHook` annotations, identifying method names, parameter counts, and asynchronous signatures.
- `extractWefterMethodsSwift` and `extractWefterHooksSwift`: Scans Swift files for methods annotated with `@objc` adhering to Wefter protocol conventions.
- `auditPluginConsistency`: Confirms that methods declared in `plugin.json` match the methods implemented in native source files.

### Code generation

- `generateRegistryKotlin`: Generates `GeneratedRegistry.kt` for the Android shell. Creates a map of plugin identifiers to factory functions and method dispatchers.
- `generateRegistrySwift`: Generates `GeneratedRegistry.swift` for the iOS shell, registering plugins into the central bridge dispatcher.

### Manifest and project weaving

- `copyAndroidNativeSource` and `copyIosNativeSource`: Copies native source files from plugin distributions into the target shell.
- `mergePermissions`: Injects Android permissions into `AndroidManifest.xml` within dedicated marker comments.
- `mergeManifestEntries`: Merges custom Android services, broadcast receivers, and intent filters required by plugins.
- `mergeGradleDeps`: Appends plugin-defined Gradle implementation statements into `app/build.gradle.kts`.
- `mergeProguardRules`: Merges ProGuard and R8 rules into `proguard-rules.pro` to prevent minification of native bridge classes.
- `mergeInfoPlist`: Merges privacy permission descriptions (such as camera or biometric usage strings) into iOS `Info.plist`.
- `generateNativeDependenciesPackage`: Emits a local Swift Package Manager definition (`Package.swift`) containing external dependencies declared by plugins.
- `copyWebAssets`: Copies compiled web application files into Android `src/main/assets` or the iOS main bundle.

## Synchronization pipeline

During `wefter sync`, the modules run in sequence:

1. Discover plugins from configuration and validate manifests.
2. Verify native source implementations match declared methods.
3. Copy native sources to the shell project.
4. Merge platform dependencies, permissions, and build settings.
5. Emit `GeneratedRegistry.kt` and `GeneratedRegistry.swift`.
6. Copy compiled web assets.

## Development

```bash
pnpm build   # compiles TypeScript via tsc
pnpm test    # runs unit tests and fixture comparisons via Vitest
```

## License

[MIT](../../LICENSE) © 2026 Sandip Ghimire

