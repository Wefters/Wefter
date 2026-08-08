import Foundation

final class SystemModule: NativeModule {
    private weak var viewController: ViewController?

    init(viewController: ViewController) {
        self.viewController = viewController
    }

    func invoke(method: String, payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        switch method {
        case "isDebug":
            #if DEBUG
            callback(.success(["debug": true]))
            #else
            callback(.success(["debug": false]))
            #endif
        case "appReady":
            viewController?.dispatcher.dispatchHook("appReady")
            callback(.success([:]))
        default:
            callback(.failure(WefterError(code: "UNKNOWN_METHOD", message: "No such method: \(method)")))
        }
    }
}
