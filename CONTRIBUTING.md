# Contributing to Wefter Core

This repository is the central monorepo for the Wefter mobile framework. It houses the runtime bridge library, command line tool, developer tools, code generator, and native shell templates.

## Code of conduct

Please review and adhere to the [code of conduct](https://github.com/Wefters/.github/blob/main/CODE_OF_CONDUCT.md).

## Monorepo layout

This workspace is managed using pnpm workspaces:

- `packages/core`: The JavaScript runtime bridge (`@wefterjs/core`) bundled into applications.
- `packages/cli`: The `wefter` binary (`@wefterjs/cli`) driving compilation, synchronization, and device running.
- `packages/devtools`: Vite integration plugin, on-device diagnostic drawer, and dashboard server (`@wefterjs/devtools`).
- `packages/registry-codegen`: Static code generator and manifest weaving engine (`@wefterjs/registry-codegen`).
- `shells/android-template`: The Kotlin Android application shell.
- `shells/ios-template`: The Swift iOS application shell.

## Development setup

### Prerequisites

- Node.js 18 or later
- pnpm 9 or later
- JDK 17 with `ANDROID_HOME` configured (for Android verification)
- macOS with Xcode 16 or later (for iOS verification)

### Installation and build

Clone the repository and install all dependencies:

```bash
git clone https://github.com/Wefters/Wefter.git
cd Wefter
pnpm install
```

Build all packages in topological order:

```bash
pnpm build
```

Run test suites across all packages:

```bash
pnpm test
```

## Package development workflows

### CLI development (`packages/cli`)

You can run the CLI directly from TypeScript source without a separate build step:

```bash
cd packages/cli
pnpm dev doctor
pnpm dev sync /path/to/test-project
```

### Core runtime (`packages/core`)

Changes to `@wefterjs/core` affect the code executed inside the mobile web view. Use the testing utilities in `@wefterjs/core/testing` to write unit tests for any new bridge functions.

```bash
cd packages/core
pnpm test
```

### Developer tools (`packages/devtools`)

The devtools package contains both a Node.js Vite server plugin and a client-side browser agent bundled with esbuild:

```bash
cd packages/devtools
pnpm build   # runs tsc and scripts/build-client.mjs
pnpm test
```

### Registry code generator (`packages/registry-codegen`)

The codegen package uses fixtures to verify that Kotlin and Swift registry code is emitted accurately:

```bash
cd packages/registry-codegen
pnpm test
```

## Testing changes with Demo-App

To test your monorepo changes in a realistic mobile application:

1. Navigate to the `Demo-App` directory located alongside `Wefter`.
2. Run `pnpm install` to link local workspace dependencies.
3. Build the core packages (`pnpm -r build` inside `Wefter`).
4. Test in the browser with `pnpm dev` or test on an emulator with `npx wefter run android --watch`.

## Pull request guidelines

1. Create a dedicated branch for your work:
   ```bash
   git checkout -b feature/cli-interactive-doctor
   ```
2. Verify that `pnpm build` and `pnpm test` pass before submitting.
3. Keep pull requests focused on a single change or feature.
4. Reference related issues in the PR description using `Fixes #...`.

## License

By contributing to Wefter, you agree that your contributions will be licensed under the [MIT License](LICENSE).

