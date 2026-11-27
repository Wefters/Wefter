import Foundation
import WebKit

/// Which pages may call which plugins through the bridge.
///
/// The app's own pages (the bundled app, or the dev server in debug builds) may call everything, in any
/// frame. Another site may only call the plugin methods `frames.plugins` in `wefter.config.json` grants it,
/// such as `biometric.authenticate` or `haptics.*`; every other site is refused.
struct BridgeAccess {
    /// Whether an origin is one of the app's own pages.
    let isOwnOrigin: (WKSecurityOrigin) -> Bool
    /// Granted methods by origin (`https://pay.example.com`), as `plugin.method` or `plugin.*`.
    let grants: [String: [String]]

    /// Whether `origin` may call `method` of `plugin`. The built-in `__system` module is the app's own.
    func allows(_ origin: WKSecurityOrigin, plugin: String, method: String) -> Bool {
        if isOwnOrigin(origin) { return true }
        if plugin.hasPrefix("__") { return false }
        let methods = grants[Self.string(for: origin)] ?? []
        return methods.contains("\(plugin).\(method)") || methods.contains("\(plugin).*")
    }

    /// `scheme://host[:port]` of `origin`, the way `frames` in `wefter.config.json` writes origins.
    static func string(for origin: WKSecurityOrigin) -> String {
        let port = origin.port == 0 ? "" : ":\(origin.port)"
        return "\(origin.protocol)://\(origin.host)\(port)"
    }
}
