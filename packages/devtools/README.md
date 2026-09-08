<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../Logo/Dark/Icon.svg">
    <source media="(prefers-color-scheme: light)" srcset="../../Logo/Light/Icon.svg">
    <img alt="Wefter" src="../../Logo/Light/Icon.svg" width="72">
  </picture>

  <h1>@wefterjs/devtools</h1>
  <p><strong>Development overlay and browser inspection dashboard for Wefter applications.</strong></p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-0.0.1-blue?style=flat-square">
    <a href="../../LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  </p>

  <p>
    <a href="https://wefter.dev"><strong>Documentation</strong></a> ·
    <a href="https://github.com/Wefters/Wefter">Wefter monorepo</a> ·
    <a href="https://discord.gg/wefter">Discord</a>
  </p>
</div>

---

`@wefterjs/devtools` is a Vite plugin that connects your running mobile application to an inspection environment. It captures bridge invocations, native event dispatches, network traffic, and console output, displaying them in both an on-device drawer and a dedicated desktop browser dashboard.

## Installation

Install as a development dependency in your web application project:

```bash
pnpm add -D @wefterjs/devtools
```

## Setup in Vite

Add `wefterDevtools` to your `vite.config.ts` plugins array:

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { wefterDevtools } from "@wefterjs/devtools";

export default defineConfig({
  plugins: [
    vue(),
    wefterDevtools(),
  ],
});
```

The plugin only activates during local development (`apply: "serve"`). It is automatically excluded from production builds.

## How it works

When the Vite development server starts:

1. **Client agent injection**: The plugin hooks `transformIndexHtml` to inject a lightweight client agent module into the application `<head>`.
2. **Bridge instrumentation**: Inside the running app, `@wefterjs/core` detects the devtools agent and routes bridge telemetry (payloads, response times, errors) to the local Vite server over WebSockets.
3. **Console and network monitoring**: Standard `console.log`, `console.error`, and `fetch` calls are captured and forwarded to the devtools state store.
4. **On-device overlay**: A collapsible diagnostic panel appears directly in the web view on the device or simulator, letting developers inspect local state without connecting a desktop debugger.
5. **Desktop dashboard**: A full screen web dashboard is served directly from the Vite dev server at `/__wefter/dashboard`.

## Dashboard and routes

The devtools server adds internal middleware routes to your Vite server:

| Route | Description |
| --- | --- |
| `/__wefter/dashboard` | Standalone browser user interface displaying connected device presence, real-time bridge invocation logs, console history, and network request timings. |
| `/__wefter/api/plugins` | JSON endpoint returning metadata for all plugins declared in `wefter.config.json`, including exported methods, supported hooks, and required permissions. |

## WebSocket messages

The server and client communicate over Vite's internal WebSocket channel using typed event prefixes:

- `wefter:devtools:bridge`: Emitted when `invokeNative` is called or returns, containing method name, payload, execution time, and error details.
- `wefter:devtools:console`: Emitted on captured console activity.
- `wefter:devtools:network`: Emitted on captured network requests and responses.
- `wefter:devtools:presence`: Signals device connection or disconnection.
- `wefter:devtools:reload`: Triggers an application reload on connected devices.

## Development

```bash
pnpm build   # compiles TypeScript and bundles the client agent via esbuild
pnpm test    # runs unit tests with Vitest and JSDOM
```

## License

[MIT](../../LICENSE) © 2026 Sandip Ghimire

