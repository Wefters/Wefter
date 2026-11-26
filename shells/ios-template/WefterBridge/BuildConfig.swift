import Foundation

/// Settings the CLI writes at sync and run time: the dev server URL (debug only), the splash screen, the
/// orientation and the keyboard. Edit `wefter.config.json` instead of this file.
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

    // WEFTER-KEYBOARD-CONFIG-START
    static let formAccessoryBar = false
    // WEFTER-KEYBOARD-CONFIG-END
}
