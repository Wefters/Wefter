import Foundation

/// Registry of plugin instances by id, so native code (for example another plugin) can reach a plugin.
/// Thread-safe.
public enum WefterBridge {
    private static var plugins: [String: WefterPlugin] = [:]
    private static let lock = NSLock()

    /// Stores a plugin under its id. Called by the generated registry.
    static func register(_ pluginId: String, plugin: WefterPlugin) {
        lock.lock()
        defer { lock.unlock() }
        plugins[pluginId] = plugin
    }

    /// The plugin registered under `pluginId`, if any.
    public static func plugin(withId pluginId: String) -> WefterPlugin? {
        lock.lock()
        defer { lock.unlock() }
        return plugins[pluginId]
    }
}
