import Foundation
#if canImport(UIKit)
import UIKit
import UserNotifications
#endif

/// Base class for native plugins. Subclasses expose methods to JavaScript with `func name(payload:callback:)
/// throws` marked as bridge methods, and settle each call with `resolve` or `reject`.
///
/// A plugin lives as long as the app's screen: it is created once, even when the web view is rebuilt after
/// its content process crashed. Override the `app…`, `handle…` and notification methods to follow the app's
/// lifecycle; ``PluginHost`` calls them.
open class WefterPlugin {
    public let dispatcher: BridgeDispatcher

    #if canImport(UIKit)

    public weak var viewController: UIViewController?

    /// Creates the plugin. `viewController` is the screen hosting the web view, for presenting native UI.
    public required init(dispatcher: BridgeDispatcher, viewController: UIViewController?) {
        self.dispatcher = dispatcher
        self.viewController = viewController
    }
    #else
    public required init(dispatcher: BridgeDispatcher) {
        self.dispatcher = dispatcher
    }
    #endif

    /// Completes a call successfully with `data`.
    public func resolve(_ callback: (Result<Any, Error>) -> Void, data: [String: Any] = [:]) {
        callback(.success(data))
    }

    /// Fails a call with an error code and message.
    public func reject(_ callback: (Result<Any, Error>) -> Void, code: String, message: String) {
        callback(.failure(WefterError(code: code, message: message)))
    }

    /// Sends an event to JavaScript listeners registered with `registerHook(hookName, …)`.
    ///
    /// With `hold`, the event waits in ``EventInbox`` until the page listens for `hookName`, so it is not
    /// lost when it happens before the page has loaded (a notification tap that launched the app). Without
    /// it, only listeners registered at that moment get it.
    public func emit(_ hookName: String, _ data: [String: Any], hold: Bool = false) {
        if hold {
            EventInbox.shared.hold(hookName, data)
        } else {
            dispatcher.emit(hookName, data)
        }
    }

    /// Opens this app's page in the Settings app, where the user can change its permissions.
    public func openAppSettings() {
        Permissions.openAppSettings()
    }

    #if canImport(UIKit)

    /// The app became active (in front and receiving events).
    open func appDidBecomeActive() {}

    /// The app is about to become inactive (a call, the app switcher, going to the background).
    open func appWillResignActive() {}

    /// The app went to the background.
    open func appDidEnterBackground() {}

    /// The app is coming back from the background.
    open func appWillEnterForeground() {}

    /// A URL opened the running app (a custom scheme). Return `true` when the plugin handled it; otherwise
    /// it is treated as a deep link.
    open func handleOpenURL(_ url: URL) -> Bool { false }

    /// A user activity continued in the running app (a Universal Link, Handoff). Return `true` when the
    /// plugin handled it; otherwise a web link in it is treated as a deep link.
    open func handleUserActivity(_ userActivity: NSUserActivity) -> Bool { false }

    /// The app registered for remote notifications and got its device token.
    open func didRegisterForRemoteNotifications(deviceToken: Data) {}

    /// Registering for remote notifications failed.
    open func didFailToRegisterForRemoteNotifications(error: Error) {}

    /// How to show `notification`, which arrived while the app is in front. Return `nil` to leave it to
    /// another plugin; when no plugin answers, iOS shows nothing.
    open func presentationOptions(for notification: UNNotification) -> UNNotificationPresentationOptions? { nil }

    /// The user acted on a notification (a tap, or an action button), possibly launching the app. Return
    /// `true` when the plugin handled it.
    open func handleNotificationResponse(_ response: UNNotificationResponse) -> Bool { false }
    #endif
}
