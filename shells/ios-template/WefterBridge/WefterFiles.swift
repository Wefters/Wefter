import Foundation

/// The running environment, and the files `nativeFiles` in `wefter.config.json` lists for it (such as
/// Firebase's `GoogleService-Info.plist`). `wefter sync` bundles each environment's files under
/// `EnvironmentFiles/<environment>/`.
public enum WefterFiles {
    /// The environment this build is for (`development`, `production`, …), from `WefterEnvironment` in
    /// `Info.plist`.
    public static let environment: String = {
        if let name = Bundle.main.object(forInfoDictionaryKey: "WefterEnvironment") as? String,
           !name.isEmpty, !name.hasPrefix("$(") {
            return name
        }
        #if DEBUG
        return "development"
        #else
        return "production"
        #endif
    }()

    /// The running environment's copy of `name` (for example `GoogleService-Info.plist`), or `nil` when the
    /// environment has no such file.
    public static func url(named name: String) -> URL? {
        let url = Bundle.main.bundleURL
            .appendingPathComponent("EnvironmentFiles", isDirectory: true)
            .appendingPathComponent(environment, isDirectory: true)
            .appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
}
