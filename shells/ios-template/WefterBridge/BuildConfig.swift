import Foundation

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
}
