import Foundation

/// Settings the CLI writes at sync and run time: the dev server URL (debug only), the splash screen, the
/// orientation, the keyboard, the system bars and gestures, and the launch colour. Edit `wefter.config.json` instead of this file.
enum BuildConfig {
    #if DEBUG
    static let devServerURL = "" // WEFTER overridden per-run by the CLI
    #else
    static let devServerURL = "" // WEFTER always empty in release — never shippable
    #endif

    // WEFTER-SPLASH-CONFIG-START
    static let splashEnabled = false
    static let splashMinDurationMs: Double = 0
    static let splashMaxDurationMs: Double = 5000
    static let splashWaitForReady = true
    static let splashFadeTransition = true
    // WEFTER-SPLASH-CONFIG-END

    // WEFTER-ORIENTATION-CONFIG-START
    static let landscape = false
    // WEFTER-ORIENTATION-CONFIG-END

    // Other sites the app's pages may embed (frame-src), and the plugin methods each may call ("frames").
    // WEFTER-FRAMES-CONFIG-START
    static let frameSources = ""
    static let framePluginGrants: [String: [String]] = [:]
    // WEFTER-FRAMES-CONFIG-END

    // WEFTER-KEYBOARD-CONFIG-START
    static let formAccessoryBar = false
    // WEFTER-KEYBOARD-CONFIG-END

    // The system bars, gestures, audio and text settings, from "profile", "systemBars", "gestures", "audio"
    // and "text", as JSON (see SystemUI.swift).
    // WEFTER-SYSTEM-UI-CONFIG-START
    static let systemUI = ""
    // WEFTER-SYSTEM-UI-CONFIG-END

    // WEFTER-LAUNCH-BACKGROUND-START
    static let launchBackground: (red: Double, green: Double, blue: Double) = (1, 1, 1)
    // WEFTER-LAUNCH-BACKGROUND-END
}
