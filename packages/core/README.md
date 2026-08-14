<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../Logo/Dark/Icon.svg">
    <source media="(prefers-color-scheme: light)" srcset="../../Logo/Light/Icon.svg">
    <img alt="Wefter" src="../../Logo/Light/Icon.svg" width="72">
  </picture>

  <h1>@wefterjs/core</h1>
  <p><strong>The typed JS ↔ native bridge runtime that ships inside a compiled Wefter app.</strong></p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-0.0.1-blue?style=flat-square">
    <a href="../../LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  </p>

  <p>
    <a href="https://wefter.dev/docs/javascript-apis"><strong>API docs</strong></a> ·
    <a href="https://github.com/Wefters/Wefter">Wefter monorepo</a> ·
    <a href="https://discord.gg/wefter">Discord</a>
  </p>
</div>

---

It gives your JS code a single, typed bridge to native plugin capability
on both Android (Kotlin) and iOS (Swift), through the same functions
either way.

## Install

```bash
pnpm add @wefterjs/core
```

This is a real runtime dependency, not a dev dependency, since your app
imports it at run time on the device. Its counterpart, `@wefterjs/cli`, is
a dev dependency instead, since it never ships in the built app.

## Usage

Most of the time you won't call this package's functions directly. A
plugin you install with `wefter add` exposes its own wrapper functions
(`Scanner.open()`, `Storage.get()`) that call into `@wefterjs/core`
underneath. You'll reach for it directly for built-in system calls, or to
check on the bridge itself:

```ts
import { invokeNative, isNativeBridgeAvailable, getDeviceInfo, hideSplash } from "@wefterjs/core";

if (isNativeBridgeAvailable()) {
  const { platform, osVersion } = await getDeviceInfo();
  console.log(`Running on ${platform} ${osVersion}`);
}

await hideSplash();

const { debug } = await invokeNative<{ debug: boolean }>("__system", "isDebug");
```

## API

| Export                                             | What it does                                                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invokeNative(plugin, method, payload?, options?)` | Calls a native method, returns a Promise. Every plugin wrapper calls this underneath. Rejects with a `WefterBridgeError` on timeout, abort, or no bridge present.                 |
| `registerHook(hookName, callback)`                 | Subscribes to native-pushed events (sensor readings, scan results). Returns `{ remove() }`.                                                                                       |
| `onBridgeReady()`                                  | Resolves once the native bridge is wired up. Await it once before your first plugin call to avoid a startup race.                                                                 |
| `isNativeBridgeAvailable()`                        | Synchronous check: `true` inside the native shell, `false` in a plain browser tab.                                                                                                |
| `getPlatformInfo()`                                | Synchronous, no native round-trip: `{ platform, coreVersion, environment }`.                                                                                                      |
| `getDeviceInfo()`                                  | Async native call: `{ platform, osVersion }` straight from the OS.                                                                                                                |
| `hideSplash()`                                     | Signals the app is ready so a `dismissOn: "ready"` splash screen can dismiss.                                                                                                     |
| `definePlugin(name, methods)`                      | Used by plugin authors to generate a typed wrapper object around `invokeNative`.                                                                                                  |
| `WefterBridgeError`, `WefterErrorCode`             | The error class and code union every rejected call uses (`TIMEOUT`, `ABORTED`, `NO_BRIDGE`, `UNKNOWN_PLUGIN`, `INVALID_PAYLOAD`, `PLUGIN_THREW`, `PERMISSION_DENIED`, `UNKNOWN`). |

## Testing

`@wefterjs/core/testing` mocks the bridge so you can test components that
call plugins without a real device or emulator:

```ts
import { installMockBridge, uninstallMockBridge } from "@wefterjs/core/testing";
import { getDeviceInfo } from "@wefterjs/core";

installMockBridge({
  __system: async (method) => {
    if (method === "getDeviceInfo") return { platform: "android", osVersion: "14" };
    throw new Error(`unhandled method ${method}`);
  },
});

const result = await getDeviceInfo();
expect(result.platform).toBe("android");

uninstallMockBridge();
```

Each handler receives `(method, payload)` for calls made to that plugin
name. Call `uninstallMockBridge()` afterward so later tests don't inherit
a mock they didn't set up.

## Development

```bash
pnpm build   # tsc -p tsconfig.json
pnpm test    # vitest run
```

Part of the [Wefter](https://github.com/Wefters/Wefter) monorepo. See the
root README for the full picture, and [wefter.dev](https://wefter.dev) for
complete documentation.

## License

MIT
</content>
