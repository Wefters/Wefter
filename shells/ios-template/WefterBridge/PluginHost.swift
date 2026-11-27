import UIKit
import UserNotifications

/// Passes the app's lifecycle and system callbacks to the plugins.
///
/// `AppDelegate` starts it when the app launches, so it is the notification centre's delegate before launch
/// finishes, as iOS requires to deliver a notification tap that launched the app. The plugins are created
/// later, with the app's screen; callbacks that arrive before that wait here until ``setPlugins(_:)``.
final class PluginHost: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PluginHost()

    private(set) var plugins: [WefterPlugin] = []
    private var hasPlugins = false
    private var pendingResponses: [(UNNotificationResponse, () -> Void)] = []
    private var pendingToken: Data?
    private var pendingTokenError: Error?

    private override init() {}

    /// Becomes the notification centre's delegate and starts following the app's lifecycle. Call from
    /// `application(_:didFinishLaunchingWithOptions:)`.
    func start() {
        UNUserNotificationCenter.current().delegate = self
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    /// Sets the plugins and hands them what arrived before they existed.
    func setPlugins(_ plugins: [WefterPlugin]) {
        self.plugins = plugins
        hasPlugins = true
        if let token = pendingToken {
            pendingToken = nil
            plugins.forEach { $0.didRegisterForRemoteNotifications(deviceToken: token) }
        }
        if let error = pendingTokenError {
            pendingTokenError = nil
            plugins.forEach { $0.didFailToRegisterForRemoteNotifications(error: error) }
        }
        let responses = pendingResponses
        pendingResponses.removeAll()
        for (response, done) in responses {
            deliver(response)
            done()
        }
    }

    /// Offers a URL that opened the running app to the plugins; `true` when one handled it.
    func handleOpenURL(_ url: URL) -> Bool {
        plugins.contains { $0.handleOpenURL(url) }
    }

    /// Offers a continued user activity to the plugins; `true` when one handled it.
    func handleUserActivity(_ userActivity: NSUserActivity) -> Bool {
        plugins.contains { $0.handleUserActivity(userActivity) }
    }

    func didRegisterForRemoteNotifications(deviceToken: Data) {
        if hasPlugins {
            plugins.forEach { $0.didRegisterForRemoteNotifications(deviceToken: deviceToken) }
        } else {
            pendingToken = deviceToken
        }
    }

    func didFailToRegisterForRemoteNotifications(error: Error) {
        if hasPlugins {
            plugins.forEach { $0.didFailToRegisterForRemoteNotifications(error: error) }
        } else {
            pendingTokenError = error
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let options = plugins.lazy.compactMap { $0.presentationOptions(for: notification) }.first
        completionHandler(options ?? [])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        guard hasPlugins else {
            pendingResponses.append((response, completionHandler))
            return
        }
        deliver(response)
        completionHandler()
    }

    private func deliver(_ response: UNNotificationResponse) {
        _ = plugins.contains { $0.handleNotificationResponse(response) }
    }

    // MARK: Lifecycle

    @objc private func didBecomeActive() { plugins.forEach { $0.appDidBecomeActive() } }
    @objc private func willResignActive() { plugins.forEach { $0.appWillResignActive() } }
    @objc private func didEnterBackground() { plugins.forEach { $0.appDidEnterBackground() } }
    @objc private func willEnterForeground() { plugins.forEach { $0.appWillEnterForeground() } }
}
