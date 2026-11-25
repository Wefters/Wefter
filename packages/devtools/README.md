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

`@wefterjs/devtools` is a Vite plugin that connects your running mobile application to an inspection environment. It captures bridge invocations, native event dispatches, network traffic, and console output, displaying them in a desktop browser dashboard.

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
  plugins: [vue(), wefterDevtools()],
});
```

The plugin only activates during local development (`apply: "serve"`). It is automatically excluded from production builds.

## How it works

When the Vite development server starts:

1. **Client agent injection**: The plugin hooks `transformIndexHtml` to inject a lightweight client agent module into the application `<head>`.
2. **Bridge instrumentation**: Inside the running app, `@wefterjs/core` detects the devtools agent and routes bridge telemetry (payloads, response times, errors) to the local Vite server over WebSockets.
3. **Console and network monitoring**: `console.*` calls, uncaught errors, `fetch` and `XMLHttpRequest` traffic are captured and forwarded to the dev server, which keeps a bounded history (500 bridge calls, 1000 console entries, 500 requests).
4. **Desktop dashboard**: The dashboard at `/__wefter-devtools` replays that history on open and then streams new events live. `wefter run` prints its URL when the dev server starts.

## The dashboard

| Panel       | What it shows                                                                                                                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bridge**  | Every `invokeNative` call, oldest first: status, `plugin.method`, an inline preview of the arguments, duration with a waterfall bar, and start time. Select a call to open the inspector with its arguments, result or error, and the native stack trace when the shell sends one. |
| **Console** | App console output and uncaught exceptions. Filter by level, repeated lines collapse into one row with a count, objects expand as trees, and rows with a stack trace expand inline.                                                                                                |
| **Network** | `fetch` and XHR requests, with request headers and a parsed response preview in the inspector.                                                                                                                                                                                     |
| **Plugins** | The plugins in `wefter.config.json`: methods, hooks, events, declared permissions, which platforms have native source, and how often each was called this session.                                                                                                                 |
| **Clients** | The app instances connected to this dev server.                                                                                                                                                                                                                                    |

The Bridge, Console and Network panels can be paused: the view freezes, events keep arriving, and the Resume button shows how many came in meanwhile. The count next to each tab shows failed calls, console errors (or warnings) and failed requests.

Keyboard shortcuts:

| Key                   | Action                                                 |
| --------------------- | ------------------------------------------------------ |
| `/` or `Ctrl`/`⌘` `K` | Focus the current panel's filter (`Esc` clears it)     |
| `1`–`5`               | Switch panel                                           |
| `↑` `↓` `Home` `End`  | Move between rows; the inspector follows the selection |
| `Enter` / `Space`     | Open or close the inspector for the focused row        |
| `Esc`                 | Close the inspector                                    |

The dashboard follows the system light or dark setting; the button in the top bar switches it and remembers the choice.

## Dashboard and routes

The devtools server adds internal middleware routes to your Vite server:

| Route                            | Description                                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/__wefter-devtools`             | The dashboard described above.                                                                                                                            |
| `/__wefter-devtools/api/plugins` | JSON endpoint returning metadata for all plugins declared in `wefter.config.json`, including exported methods, supported hooks, and required permissions. |

## WebSocket messages

The app, the dev server and the dashboard talk over Vite's HMR WebSocket using these events (see `src/shared/events.ts`):

- `wefter:bridge_call` / `wefter:bridge_response`: an `invokeNative` call and its result, error and duration.
- `wefter:console`: captured console output and uncaught errors.
- `wefter:network_request` / `wefter:network_response`: captured requests and their responses.
- `wefter:client_hello` / `wefter:client_list`: app presence.
- `wefter:reload`: reloads every connected app (sent by the dashboard's Reload app button).

## Development

```bash
pnpm build   # compiles TypeScript and bundles the client agent via esbuild
pnpm test    # runs unit tests with Vitest and JSDOM
```

## License

[MIT](../../LICENSE) © 2026 Sandip Ghimire
