<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../Logo/Dark/Icon.svg">
    <source media="(prefers-color-scheme: light)" srcset="../../Logo/Light/Icon.svg">
    <img alt="Wefter" src="../../Logo/Light/Icon.svg" width="72">
  </picture>

  <h1>@wefterjs/core</h1>
  <p><strong>The typed JavaScript-to-native bridge runtime bundled inside Wefter applications.</strong></p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-0.0.1-blue?style=flat-square">
    <a href="../../LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  </p>

  <p>
    <a href="https://wefter.dev/docs/javascript-apis"><strong>API documentation</strong></a> ·
    <a href="https://github.com/Wefters/Wefter">Wefter monorepo</a> ·
    <a href="https://discord.gg/wefter">Discord</a>
  </p>
</div>

---

`@wefterjs/core` provides the runtime communication layer between JavaScript running in the web view and native code on Android (Kotlin) and iOS (Swift). It exposes promise-based invocations and event subscriptions with no dependency on external servers or background processes.

## Installation

```bash
pnpm add @wefterjs/core
```

This package is a production runtime dependency. It executes on the user device inside the application bundle. In contrast, `@wefterjs/cli` is a dev dependency that operates only during development and build steps.

## Usage

Most applications do not call `@wefterjs/core` directly for standard device features. Instead, plugins such as `@wefterjs/scanner` or `@wefterjs/storage` wrap these bridge calls in dedicated TypeScript modules.

Direct calls to `@wefterjs/core` are typically used for lifecycle management, bridge readiness detection, and system queries:

```ts
import {
  invokeNative,
  isNativeBridgeAvailable,
  onBridgeReady,
  getDeviceInfo,
  getPlatformInfo,
  hideSplash,
} from "@wefterjs/core";

// Ensure the native bridge is initialized before the first call
await onBridgeReady();

if (isNativeBridgeAvailable()) {
  const { platform, osVersion } = await getDeviceInfo();
  console.log(`Running on ${platform} ${osVersion}`);
}

// Inspect current platform environment synchronously
const platformInfo = getPlatformInfo();
console.log("Core protocol version:", platformInfo.coreVersion);

// Dismiss a configured splash screen
await hideSplash();

// Make a raw system invocation
const { isDebug } = await invokeNative<{ isDebug: boolean }>("__system", "isDebug");
```

## JavaScript API reference

### Bridge functions

| Export | Description |
| --- | --- |
| `invokeNative<T>(plugin, method, payload?, options?)` | Sends a message to the native bridge and returns a Promise that resolves with the native response or rejects with a `WefterBridgeError`. |
| `registerHook(hookName, callback)` | Subscribes to native push events (such as hardware back button presses, barcode scans, or network state transitions). Returns an object with a `remove()` cleanup method. |
| `onBridgeReady()` | Returns a Promise that resolves once the native bridge objects (`window.AndroidBridge` or `window.webkit.messageHandlers`) are registered. |
| `isNativeBridgeAvailable()` | Synchronous helper returning `true` when running inside a native Wefter shell, and `false` in a standard browser tab. |
| `getPlatformInfo()` | Synchronous helper returning `{ platform, coreVersion, environment }` without native dispatch overhead. |
| `getDeviceInfo()` | Asynchronous native call returning `{ platform, osVersion }` directly from the host operating system. |
| `hideSplash()` | Signals the native shell to dismiss the splash screen when configured with `waitForReady: true`. |
| `isLandscape()` | Returns `true` if the shell was built with landscape lock enabled. |
| `definePlugin<T>(name, methodMap)` | Helper used by plugin authors to construct typed proxy objects around `invokeNative`. |

### Error handling

When a bridge call fails, the returned Promise rejects with a `WefterBridgeError`. Inspect the `code` property to handle specific failures:

```ts
import { invokeNative, WefterBridgeError } from "@wefterjs/core";

try {
  await invokeNative("storage", "get", { key: "auth_token" });
} catch (error) {
  if (error instanceof WefterBridgeError) {
    console.error("Bridge failure code:", error.code);
    console.error("Bridge failure message:", error.message);
  }
}
```

Standard error codes include:

- `TIMEOUT`: The native call did not complete within the requested timeout period.
- `ABORTED`: The call was cancelled before completion.
- `NO_BRIDGE`: The bridge is unavailable (for example, when running inside an unsupported browser tab).
- `UNKNOWN_PLUGIN`: The requested plugin identifier is not registered in the native project.
- `INVALID_PAYLOAD`: The payload could not be serialized or does not match expected parameters.
- `PLUGIN_THREW`: The native plugin threw an unhandled exception.
- `PERMISSION_DENIED`: The user or OS rejected a required permission.
- `UNKNOWN`: General unhandled native failure.

## Testing with mock bridge

The `@wefterjs/core/testing` submodule allows testing UI components and plugins in browser tests or Node.js without requiring an emulator or physical device:

```ts
import { installMockBridge, uninstallMockBridge } from "@wefterjs/core/testing";
import { getDeviceInfo } from "@wefterjs/core";

// Register custom mock handlers per plugin
installMockBridge({
  __system: async (method, payload) => {
    if (method === "getDeviceInfo") {
      return { platform: "android", osVersion: "14" };
    }
    throw new Error(`Unhandled system method: ${method}`);
  },
  storage: async (method, payload) => {
    if (method === "get") {
      return { value: "test-token" };
    }
    return { success: true };
  },
});

const info = await getDeviceInfo();
console.log("Mocked platform:", info.platform);

// Clean up after test completion
uninstallMockBridge();
```

## Development

```bash
pnpm build   # compiles TypeScript via tsc
pnpm test    # runs test suites via Vitest
```

## License

[MIT](../../LICENSE) © 2026 Sandip Ghimire
