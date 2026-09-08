import Foundation
import UIKit

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
        case "getDeviceInfo":
            callback(.success([
                "platform": "ios",
                "osVersion": UIDevice.current.systemVersion,
            ]))
        case "appReady":
            viewController?.dispatcher.dispatchHook("appReady")
            callback(.success([:]))
        case "hideSplash":
            viewController?.dispatcher.dispatchHook("hideSplash")
            callback(.success([:]))
        case "isLandscape":
            DispatchQueue.main.async {
                let isLandscape: Bool
                if #available(iOS 13.0, *), let windowScene = self.viewController?.view.window?.windowScene {
                    isLandscape = windowScene.interfaceOrientation.isLandscape
                } else {
                    let orientation = UIApplication.shared.statusBarOrientation
                    isLandscape = orientation.isLandscape
                }
                callback(.success(["landscape": isLandscape]))
            }
        default:
            callback(.failure(WefterError(code: "UNKNOWN_METHOD", message: "No such method: \(method)")))
        }
    }
}
