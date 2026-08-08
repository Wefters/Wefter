import Foundation
#if canImport(UIKit)
import UIKit
#endif

open class WefterPlugin {
    public let dispatcher: BridgeDispatcher

    #if canImport(UIKit)

    public weak var viewController: UIViewController?

    public required init(dispatcher: BridgeDispatcher, viewController: UIViewController?) {
        self.dispatcher = dispatcher
        self.viewController = viewController
    }
    #else
    public required init(dispatcher: BridgeDispatcher) {
        self.dispatcher = dispatcher
    }
    #endif

    public func resolve(_ callback: (Result<Any, Error>) -> Void, data: [String: Any] = [:]) {
        callback(.success(data))
    }

    public func reject(_ callback: (Result<Any, Error>) -> Void, code: String, message: String) {
        callback(.failure(WefterError(code: code, message: message)))
    }

    public func emit(_ hookName: String, _ data: [String: Any]) {
        dispatcher.emit(hookName, data)
    }
}
