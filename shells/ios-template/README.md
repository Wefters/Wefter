# iOS shell template

The iOS native application template used by `wefter sync` to build iOS applications.

When targeting iOS, Wefter generates a project in `.wefter/native/ios` using this template. Native plugin sources written in Swift are copied into the project, dependencies are merged into a local Swift package, and the app target is prepared for compilation via `xcodebuild` or Xcode.

## Architecture

The shell is written in Swift using modern Apple frameworks:

### Core components

- `ViewController.swift`: Hosts the `WKWebView`, initializes WebKit configuration, sets user agent metadata, and connects message handlers.
- `BridgeDispatcher.swift`: Central routing controller for iOS. It conforms to `WKScriptMessageHandler`, receiving bridge messages from JavaScript, dispatching calls to registered plugins, and executing JavaScript callbacks on `window.__wefterNative`.
- `WefterPlugin.swift`: Protocol and base class that iOS plugins conform to. Provides references to the root view controller, bridge dispatcher, and promise resolution helpers.
- `GeneratedRegistry.swift`: Emitted during `wefter sync`. Maps plugin names to Swift class initializers and provides direct method invocation without reflection.
- `BuildConfig.swift`: Contains build-time variables such as developer server URLs and splash screen timeout configuration.
- `Config/*.xcconfig`: Holds build settings, bundle identifiers, and display names corresponding to the active environment (`development` or `production`).

## Automatic source synchronization

This template uses the Xcode 16 `PBXFileSystemSynchronizedRootGroup` feature (`objectVersion = 77`) for the `WefterBridge/Plugins/` directory.

Any `.swift` file copied into `WefterBridge/Plugins/` by `wefter sync` is indexed and compiled by Xcode automatically, without modifying the underlying `project.pbxproj` file. This provides the same behavior on iOS that Gradle provides on Android when dropping source files into `src/main/java`.

## Swift package dependencies

When plugins declare native iOS dependencies, `wefter sync` writes a `Package.swift` file inside `NativeDependencies/`.

To configure dependencies in Xcode:

1. Open `WefterBridge.xcodeproj` in Xcode 16 or later.
2. Select *File > Add Package Dependencies > Add Local...*
3. Choose the `NativeDependencies` directory in the project.
4. Add the package to the `WefterBridge` target.

Once added, any dependencies declared in plugin manifests are resolved through standard Swift Package Manager workflows.

## Requirements

- macOS with Xcode 16 or later
- iOS 15.0 deployment target or later
