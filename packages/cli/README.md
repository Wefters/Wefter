<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../Logo/Dark/Icon.svg">
    <source media="(prefers-color-scheme: light)" srcset="../../Logo/Light/Icon.svg">
    <img alt="Wefter" src="../../Logo/Light/Icon.svg" width="72">
  </picture>

  <h1>@wefterjs/cli</h1>
  <p><strong>The <code>wefter</code> command: sync, build, run, and eject a Wefter app's native project.</strong></p>

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

It reads `wefter.config.json`, weaves your declared plugins into a real
native Android/iOS project, and drives build/run/eject for that project.

## Install

```bash
pnpm add -D @wefterjs/cli
```

Dev dependency only, the CLI never ships inside the built app. Your app's
runtime dependency is [`@wefterjs/core`](../@wefterjs/cli).

## Requirements

- Node 18+
- JDK 17 and the Android SDK (`ANDROID_HOME`/`ANDROID_SDK_ROOT`, with
  `platform-tools` on `PATH`) for Android targets
- Xcode 16+ for iOS targets

Run `wefter doctor` to check your machine against all of these at once.
Full setup walkthrough: [wefter.dev/docs/environment-setup](https://wefter.dev/docs/environment-setup).

## Quick start

```bash
wefter add @yourorg/scanner-plugin   # install + validate + declare a plugin
wefter sync                          # weave declared plugins into the native project
wefter run android --watch           # build, install, launch, hot-reload
```

## Commands

| Command                                                                                    | What it does                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wefter doctor [projectDir] [--release-readiness]`                                         | Checks your environment is set up correctly. `--release-readiness` also checks the project itself is ready for a `--release` build.                   |
| `wefter sync [projectDir] [--update-lock]`                                                 | Resolves declared plugins, verifies lockfile integrity, regenerates the native project. `--update-lock` accepts and re-locks drifted plugin versions. |
| `wefter build <android\|ios> [projectDir] [--release] [--env <name>] [--simulator <name>]` | Syncs and builds the native app.                                                                                                                      |
| `wefter run <android\|ios> [projectDir] [--watch] [--env <name>] [--simulator <name>]`     | Syncs, builds, installs, and launches the app. `--watch` starts a local dev server for hot reload.                                                    |
| `wefter eject [projectDir]`                                                                | Copies the generated native project(s) to `android/` and `ios/` for hand-editing. Wefter stops regenerating them after this.                          |
| `wefter audit [projectDir]`                                                                | Read-only: prints the plugins, permissions, and dependencies this project would sync, plus lockfile drift and permission violations.                  |
| `wefter add <plugin> [projectDir]`                                                         | Installs an npm package, validates it as a Wefter plugin, and declares it in `wefter.config.json` only if it passes.                                  |
| `wefter create-plugin <name> [targetDir]`                                                  | Scaffolds a new Wefter plugin package from working boilerplate.                                                                                       |
| `wefter icon generate <source> [projectDir]`                                               | Previews Android launcher icons from a source image. Lost on the next `sync` unless `"icon"` is also set in `wefter.config.json`.                     |
| `wefter splash generate [targetPath] [projectDir]`                                         | Scaffolds an example splash folder to edit and point `wefter.config.json` at.                                                                         |
| `wefter plugin validate [pluginDir]`                                                       | Validates a plugin directory against the Wefter plugin schema and source conventions.                                                                 |

Run `wefter <command> --help` for a command's full option list.

## How `sync` works

`sync` never hand-edits a native project you own. It regenerates a
disposable one, `.wefter/native/android` and/or `.wefter/native/ios`, from
your `wefter.config.json` and declared plugins every time it runs: native
plugin source gets copied in, Gradle/CocoaPods dependencies and platform
permissions get merged, and a typed plugin registry gets generated. `wefter
eject` is the escape hatch if you need to hand-edit the native project
directly. After that, `sync` stops touching it.

## Programmatic use

Most of the CLI's internals are also exported for use as a library, the
same `sync`, `build`, `run`, `audit`, doctor checks, and native-project
path helpers the `wefter` binary itself calls:

```ts
import { sync, build, runAllChecks } from "@wefterjs/cli";
```

## Development

```bash
pnpm dev     # tsx src/cli.ts, run the CLI from source
pnpm build   # tsc -p tsconfig.json
pnpm test    # vitest run
```

Depends on [`@wefterjs/registry-codegen`](../registry-codegen) for the
underlying plugin scanning, validation, and Android/iOS codegen.

Part of the [Wefter](https://github.com/Wefters/Wefter) monorepo. See the
root README for the full picture, and [wefter.dev](https://wefter.dev) for
complete documentation.

## License

MIT
</content>
