import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Base class for native plugins. Subclasses expose methods to JavaScript with `func name(payload:callback:)
/// throws` marked as bridge methods, and settle each call with `resolve` or `reject`.
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
    public func emit(_ hookName: String, _ data: [String: Any]) {
        dispatcher.emit(hookName, data)
    }
}
