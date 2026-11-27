import UIKit

/// Creates the app's window with the web view controller as its root, and passes the URLs the app is
/// opened with (custom schemes and Universal Links) to ``DeepLinkInbox``.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    /// Sets up the window. A link that launched the app arrives here, in `connectionOptions`.
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let launchUrl =
            connectionOptions.urlContexts.first?.url
            ?? connectionOptions.userActivities.lazy.compactMap(Self.webLink(from:)).first
        DeepLinkInbox.shared.launch(with: launchUrl)

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = ViewController()
        self.window = window
        window.makeKeyAndVisible()
    }

    /// A custom-scheme link opened while the app is running. Plugins see it first.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts where !PluginHost.shared.handleOpenURL(context.url) {
            DeepLinkInbox.shared.receive(context.url)
        }
    }

    /// A Universal Link (or other user activity) continued while the app is running. Plugins see it first.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if PluginHost.shared.handleUserActivity(userActivity) { return }
        if let url = Self.webLink(from: userActivity) {
            DeepLinkInbox.shared.receive(url)
        }
    }

    /// The web page URL of a Universal Link activity, or `nil` for other activities.
    private static func webLink(from activity: NSUserActivity) -> URL? {
        guard activity.activityType == NSUserActivityTypeBrowsingWeb else { return nil }
        return activity.webpageURL
    }
}
