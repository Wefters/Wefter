import Foundation

/// Holds the URLs the app is opened with until the web app takes them through `__system.takeDeepLinks`.
///
/// `SceneDelegate` puts links in as they arrive, which can be before the web view or its page exist. The
/// inbox lives for the whole process, so links survive a page reload or a web content process crash. Used
/// on the main thread only.
final class DeepLinkInbox {
    static let shared = DeepLinkInbox()

    /// Links kept while the web app is not taking them; older ones are dropped beyond this.
    private static let maxPendingLinks = 20

    /// The URL that opened the current window, or `nil` when it was opened normally.
    private(set) var launchUrl: String?

    private var pending: [[String: Any]] = []
    private var onReceive: (() -> Void)?

    private init() {}

    /// Starts a new window session: records its launch URL (if any) and drops links left from an earlier one.
    func launch(with url: URL?) {
        launchUrl = url?.absoluteString
        pending.removeAll()
        if let url { enqueue(url, isLaunch: true) }
    }

    /// Adds a link that reached the app while it was running.
    func receive(_ url: URL) {
        enqueue(url, isLaunch: false)
    }

    /// Returns the waiting links, oldest first, and empties the inbox.
    func take() -> [[String: Any]] {
        defer { pending.removeAll() }
        return pending
    }

    /// Sets the callback run whenever a link arrives (the web view then fetches it with ``take()``).
    func setListener(_ listener: (() -> Void)?) {
        onReceive = listener
    }

    /// Stores a link and tells the listener.
    private func enqueue(_ url: URL, isLaunch: Bool) {
        pending.append(["url": url.absoluteString, "isLaunch": isLaunch])
        if pending.count > Self.maxPendingLinks {
            pending.removeFirst(pending.count - Self.maxPendingLinks)
        }
        onReceive?()
    }
}
