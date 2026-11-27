import Foundation

/// Holds plugin events until the web app takes them through `__system.takeEvents`, for events that can
/// happen before the page listens: a notification tap that launched the app, for example. Plugins add them
/// with `emit(_:_:hold: true)`.
///
/// Like ``DeepLinkInbox`` it lives for the whole process, so events survive a page reload or a web content
/// process crash; they are lost if the process ends. `@wefterjs/core` takes the events of a name when the
/// first listener for it registers, and again whenever the inbox says more arrived. Thread-safe.
final class EventInbox {
    static let shared = EventInbox()

    /// Events of one name kept while nobody takes them; older ones are dropped beyond this.
    private static let maxPerName = 20

    private let lock = NSLock()
    private var held: [String: [[String: Any]]] = [:]
    private var onHold: ((String) -> Void)?

    private init() {}

    /// Keeps `data` under `name` and tells the listener.
    func hold(_ name: String, _ data: [String: Any]) {
        lock.lock()
        var events = held[name] ?? []
        events.append(data)
        if events.count > Self.maxPerName { events.removeFirst(events.count - Self.maxPerName) }
        held[name] = events
        let listener = onHold
        lock.unlock()
        listener?(name)
    }

    /// Returns the events held under `name`, oldest first, and forgets them.
    func take(_ name: String) -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return held.removeValue(forKey: name) ?? []
    }

    /// Sets the callback run with the name of each event that arrives (the page then takes it).
    func setListener(_ listener: ((String) -> Void)?) {
        lock.lock()
        onHold = listener
        lock.unlock()
    }
}
