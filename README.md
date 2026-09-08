<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="Logo/Dark/Logo.svg">
    <source media="(prefers-color-scheme: light)" srcset="Logo/Light/Logo.svg">
    <img alt="Wefter" src="Logo/Light/Logo.svg" width="420">
  </picture>

  <p><strong>Build native Android and iOS apps with the JavaScript you already know.</strong></p>

  <p>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square"></a>
    <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white">
    <img alt="pnpm" src="https://img.shields.io/badge/pnpm-workspace-F69220?style=flat-square&logo=pnpm&logoColor=white">
    <a href="https://discord.gg/wefter"><img alt="Discord" src="https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white"></a>
  </p>

  <p>
    <a href="https://wefter.dev"><strong>Documentation</strong></a> ·
    <a href="https://discord.gg/wefter">Discord</a> ·
    <a href="https://github.com/Wefters/Docs">Docs source</a>
  </p>
</div>

---

Wefter packages your web application into a native shell and provides typed access to device hardware through a lean bridge between JavaScript and native code (Kotlin on Android, Swift on iOS). You do not need bundled runtime servers or custom rendering engines. You can write your interface in Vue, React, Angular, Svelte, or plain JavaScript.

```bash
wefter add @yourorg/scanner-plugin   # look up on registry and declare in config
pnpm add @yourorg/scanner-plugin     # install with your package manager
wefter run android --watch           # build, install, launch, and live-reload
```

The same workflow applies whether you target Android or iOS.

## How it works

The system operates across four main steps:

1. **Write your app.** Use standard web code running inside a native web view on Android or iOS.
2. **Declare native capabilities.** Running `wefter add @yourorg/scanner-plugin` checks the package on the registry, adds it to `package.json`, and records it in `wefter.config.json`. Install dependencies using your preferred package manager (pnpm, npm, yarn, or bun).
3. **Synchronize native code.** Running `wefter sync` weaves dependencies into a disposable native project (`.wefter/native/android` and `.wefter/native/ios`). Native plugin sources are copied, dependencies and permissions are merged, and a typed registry is generated automatically.
4. **Build and launch.** Running `wefter run` compiles, installs, and launches the native app on an emulator, simulator, or connected physical device, supporting hot reload during development.

At runtime, JavaScript calls native methods through a single typed bridge function, `invokeNative("scanner", "open", {})`, which returns a Promise.

## Architecture and design

Your application runs as JavaScript inside an optimized web view. Native method invocations pass directly through platform bridge handlers without an intermediary server process.

The JavaScript bridge exposes `invokeNative` and `registerHook`. Because these functions are plain JavaScript exports, they do not depend on any particular front-end framework. The same JavaScript runs on both Android and iOS without platform branches in your UI layer.

Plugins are implemented natively in Kotlin on Android and Swift on iOS. The project generated during synchronization consists of readable Kotlin and Swift templates combined with your declared plugins, avoiding proprietary bytecode or opaque wrappers.

## Repository layout

This repository is configured as a pnpm monorepo.

| Path | Description |
| --- | --- |
| [`packages/core`](packages/core) | `@wefterjs/core`, the runtime library included in your compiled web app (`invokeNative`, `registerHook`, plugin definition helpers). |
| [`packages/cli`](packages/cli) | `@wefterjs/cli`, the `wefter` command line tool (`sync`, `build`, `run`, `add`, `doctor`, `eject`, and plugin development utilities). |
| [`packages/devtools`](packages/devtools) | `@wefterjs/devtools`, Vite plugin and browser dashboard for inspecting bridge calls, events, and plugin status during development. |
| [`packages/registry-codegen`](packages/registry-codegen) | Native code generator that scans plugins, validates schemas, merges manifests, and generates typed Android and iOS registries. |
| [`shells/android-template`](shells/android-template) | Android native project template used by `wefter sync` to assemble the runnable app. |
| [`shells/ios-template`](shells/ios-template) | iOS native project template used by `wefter sync` to assemble the runnable app. |

## Getting started

Complete setup guides for Node, JDK 17, Android SDK, and Xcode are available in the documentation:

- [Environment setup](https://wefter.dev/docs/environment-setup)
- [Installation](https://wefter.dev/docs/installing)
- [App configuration](https://wefter.dev/docs/app-configuration)
- [CLI reference](https://wefter.dev/cli)
- [Writing a plugin](https://wefter.dev/plugin)

To develop on the Wefter codebase locally:

```bash
pnpm install
pnpm build   # builds packages in topological order
pnpm test    # runs unit test suites
```

## Community

- Documentation: [wefter.dev](https://wefter.dev)
- Discord: [discord.gg/wefter](https://discord.gg/wefter)
- GitHub issues: [github.com/Wefters/Wefter](https://github.com/Wefters/Wefter)

## License

[MIT](LICENSE) © 2026 Sandip Ghimire
