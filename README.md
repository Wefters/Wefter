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

Wefter wraps your web app in a thin native shell and gives it typed, pluggable
access to real device capability: camera, storage, biometrics, and more,
through a lean bridge between JavaScript and the native side (Kotlin on
Android, Swift on iOS). No backend interpreter bundled in, no custom
rendering engine to learn. Vue, React, Angular, Svelte, or plain JS, the
bridge doesn't care which one you bring.

```bash
npx wefter add @yourorg/scanner-plugin
npx wefter run android --watch
```

That's the whole workflow: write JS, declare the native capability you need,
run one command, see it on a real device. Swap `android` for `ios` and it's
the same command.

## How it works

Four moving parts, in order:

1. **You write your app.** Vue, React, Angular, Svelte, or plain JS, the
   same code you'd already write for the web, running inside a native
   WebView, on Android or iOS.
2. **You declare what native capability you need.**
   `wefter add @yourorg/scanner-plugin` installs a plugin package, validates
   it, and only if it passes, declares it in `wefter.config.json`.
3. **`wefter sync` weaves it into a real native project.** Native source
   gets copied in, dependencies and permissions get merged, and a typed
   registry gets generated, all inside a disposable, fully regenerated
   project (`.wefter/native/android` and/or `.wefter/native/ios`) you never
   hand-edit.
4. **`wefter run` builds, installs, and launches it** on a real device or
   emulator/simulator, with live reload while you're actively developing.

At runtime, your JS calls a native method through a single typed bridge
call, `invokeNative('scanner', 'open', {})`, and gets a real Promise back,
the same call either platform.

## Why Wefter

Your app is JS running in a WebView, nothing else spins up underneath it.
Native calls cross a single typed bridge with no server process in between
on either platform, and the bridge itself doesn't know or care what
rendered the page: `invokeNative` and `registerHook` are plain function
exports, not tied to any component model, so a Vue app, a React app, and a
plain `<script>` tag all call the same two functions the same way.

The same JS runs on Android and iOS with no per-platform branching in your
app code. Plugins are written natively per platform, but calling one looks
identical either way, and what ships is your app plus a thin native bridge:
no custom rendering engine, no framework runtime baked into the shell. The
generated project is a small, readable Kotlin shell on Android and Swift
shell on iOS, plus whatever plugins you declare, nothing hidden behind a
compiled binary or a proprietary format.

## Repository layout

This is a pnpm workspace monorepo.

| Path                                                     | What it is                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)                         | `@wefterjs/core`, the runtime library that ships inside your compiled app (`invokeNative`, `registerHook`, plugin definition helpers).              |
| [`packages/cli`](packages/cli)                           | `@wefterjs/cli`, the `wefter` command: `sync`, `build`, `run`, `add`, `doctor`, `eject`, and plugin authoring commands.                             |
| [`packages/registry-codegen`](packages/registry-codegen) | Internal codegen and native-project-weaving engine the CLI drives: plugin scanning, validation, Android/iOS codegen, manifest/gradle/plist merging. |
| [`shells/android-template`](shells/android-template)     | The Android native shell template `wefter sync` weaves plugins into.                                                                                |
| [`shells/ios-template`](shells/ios-template)             | The iOS native shell template `wefter sync` weaves plugins into.                                                                                    |

## Getting started

Full setup instructions (Node, JDK 17, Android SDK, Xcode) and a walkthrough
of your first project live in the docs:

- [Environment Setup](https://wefter.dev/docs/environment-setup)
- [Installing](https://wefter.dev/docs/installing)
- [App Configuration](https://wefter.dev/docs/app-configuration)
- [CLI reference](https://wefter.dev/cli)
- [Writing a plugin](https://wefter.dev/plugin)

For local development on Wefter itself:

```bash
pnpm install
pnpm build   # builds every package with a build script
pnpm test    # runs every package's test suite
```

## Community

- **Docs:** [wefter.dev](https://wefter.dev)
- **Discord:** [discord.gg/wefter](https://discord.gg/wefter)
- **Issues / discussion:** [github.com/Wefters/Wefter](https://github.com/Wefters/Wefter)

## License

[MIT](LICENSE) © 2026 Sandip Ghimire
</content>
