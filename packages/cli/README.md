<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../Logo/Dark/Icon.svg">
    <source media="(prefers-color-scheme: light)" srcset="../../Logo/Light/Icon.svg">
    <img alt="Wefter" src="../../Logo/Light/Icon.svg" width="72">
  </picture>

  <h1>@wefterjs/cli</h1>
  <p><strong>The <code>wefter</code> command: sync, build, run, and eject native mobile projects.</strong></p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-0.0.1-blue?style=flat-square">
    <a href="../../LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  </p>

  <p>
    <a href="https://wefter.dev/cli"><strong>CLI reference</strong></a> ·
    <a href="https://github.com/Wefters/Wefter">Wefter monorepo</a> ·
    <a href="https://discord.gg/wefter">Discord</a>
  </p>
</div>

---

`@wefterjs/cli` reads `wefter.config.json`, resolves declared plugins, verifies lockfiles, merges native dependencies and permissions, and manages native compilation, device deployment, and live reloading.

## Installation

```bash
pnpm add -D @wefterjs/cli
```

The CLI is installed as a development dependency. It operates on the build host and does not ship inside the compiled mobile application. The runtime counterpart is [`@wefterjs/core`](../core).

## System requirements

- Node.js 18 or later
- JDK 17 and Android SDK (`ANDROID_HOME` or `ANDROID_SDK_ROOT`, with `platform-tools` on `PATH`) for Android builds
- macOS with Xcode 16 or later for iOS builds

Run `wefter doctor` to inspect machine setup and missing dependencies automatically. Complete instructions are available in the [environment setup guide](https://wefter.dev/docs/environment-setup).

## Quick start

```bash
# Initialize Wefter in an existing web project
wefter init

# Add a plugin
wefter add @wefterjs/scanner
pnpm add @wefterjs/scanner

# Sync and launch on Android with live reload
wefter run android --watch
```

## Command reference

| Command | Description |
| --- | --- |
| `wefter init [projectDir]` | Configures an existing web project by creating `wefter.config.json`, adding `@wefterjs/core` and `@wefterjs/cli` dependencies, and updating `.gitignore`. |
| `wefter doctor [projectDir] [--release-readiness]` | Checks environment prerequisites (Node, JDK, Android SDK, Xcode, command-line tools). The `--release-readiness` flag checks signing configs, asset configurations, and production readiness. |
| `wefter sync [projectDir] [--update-lock]` | Resolves declared plugins, verifies `wefter.lock.json`, copies native plugin sources, merges permissions and Gradle/SPM dependencies, and generates typed registries. Use `--update-lock` to record updated versions. |
| `wefter build <android\|ios> [projectDir] [--release] [--env <name>] [--simulator <name>]` | Synchronizes and compiles the native application binary (`.apk` / `.aab` on Android, `.app` / `.ipa` on iOS). |
| `wefter run <android\|ios> [projectDir] [--watch] [--env <name>] [--simulator <name>]` | Synchronizes, compiles, installs, and starts the app on a connected physical device, emulator, or simulator. The `--watch` flag starts the local dev server and proxies live updates to the native web view. |
| `wefter eject [projectDir]` | Copies the disposable native project out of `.wefter/native/` to standalone `android/` and `ios/` folders for direct hand editing. After ejection, `wefter sync` stops regenerating those projects. |
| `wefter audit [projectDir]` | Read-only inspection command that prints all resolved plugins, permissions, dependencies, and lockfile status without modifying files. |
| `wefter add <plugin> [projectDir]` | Resolves a plugin from the registry, writes it into `wefter.config.json`, and records it in `package.json`. |
| `wefter create-plugin <name> [targetDir]` | Scaffolds a new standalone Wefter plugin with TypeScript, Android (Kotlin), iOS (Swift), and testing boilerplate. |
| `wefter plugin validate [pluginDir]` | Checks a plugin directory against the `plugin.json` schema and platform file layout rules. |
| `wefter icon generate <source> [projectDir]` | Generates Android launcher icon mipmap densities from a source image. |
| `wefter splash generate [targetPath] [projectDir]` | Creates an example splash screen asset directory to configure in `wefter.config.json`. |

Run `wefter <command> --help` to inspect all options for a specific command.

## Synchronization workflow

The Wefter architecture keeps native project files disposable. By default, developers do not manually maintain Xcode or Gradle project folders.

When `wefter sync` runs:

1. `wefter.config.json` is parsed to find declared plugins, splash settings, environment configurations, and target platforms.
2. The plugin scanner validates each plugin manifest (`plugin.json`) and reads declared Android dependencies, iOS Swift package dependencies, permissions, and native source directories.
3. A clean native project is created in `.wefter/native/android` or `.wefter/native/ios` based on the templates in `shells/`.
4. Native Kotlin and Swift files from each plugin are copied into the project.
5. `AndroidManifest.xml` permissions, Gradle dependencies, and iOS `Info.plist` usage keys are merged.
6. A typed registry (`GeneratedRegistry.kt` on Android, `GeneratedRegistry.swift` on iOS) is emitted so the native bridge can route calls directly without reflection.
7. Compiled web assets from `webDir` are copied into the native asset bundle.

If custom native configuration is required that cannot be expressed through plugins or `wefter.config.json`, run `wefter eject`. This copies the native shells to `android/` and `ios/` at the project root and transfers ownership of the build files to the developer.

## Programmatic API

Core CLI actions are exported as a TypeScript library for programmatic orchestration and scripting:

```ts
import { sync, build, runAllChecks } from "@wefterjs/cli";

// Run doctor diagnostics programmatically
const doctorResults = await runAllChecks();

// Run synchronization
await sync(process.cwd(), { updateLock: false });

// Run a native build
await build("android", process.cwd(), {
  release: false,
  env: "development",
});
```

## Development

```bash
pnpm dev     # runs the CLI binary directly from TypeScript source via tsx
pnpm build   # compiles TypeScript via tsc
pnpm test    # executes CLI test suites with Vitest
```

## License

[MIT](../../LICENSE) © 2026 Sandip Ghimire
