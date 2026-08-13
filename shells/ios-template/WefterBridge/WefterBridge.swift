import Foundation

/// Framework-owned registry of live plugin instances, keyed by plugin name. Lets a native
/// component that isn't the dispatcher's own view controller, a presented view controller, a
/// URL handler — reach back into a plugin to call `emit()`, without every plugin author
/// hand-rolling their own static accessor.
public enum WefterBridge {
    private static var plugins: [String: WefterPlugin] = [:]
    private static let lock = NSLock()

    static func register(_ pluginId: String, plugin: WefterPlugin) {
        lock.lock()
        defer { lock.unlock() }
        plugins[pluginId] = plugin
    }

    public static func plugin(withId pluginId: String) -> WefterPlugin? {
        lock.lock()
        defer { lock.unlock() }
        return plugins[pluginId]
    }
}
