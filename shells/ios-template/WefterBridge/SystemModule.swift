import Foundation
import UIKit

/// Built-in `__system` module used by `@wefterjs/core`: debug flag, device info, the app-ready and
/// hide-splash signals, the current orientation, deep links (from ``DeepLinkInbox``), held plugin events
/// (from ``EventInbox``), the app's settings page, web windows, back (``BackNavigation``) and the system
/// bars, gestures and safe area (``SystemUI``). Only the app's own pages reach it.
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
        case "getLaunchUrl":
            callback(.success(["url": (DeepLinkInbox.shared.launchUrl as Any?) ?? NSNull()]))
        case "takeDeepLinks":
            callback(.success(["links": DeepLinkInbox.shared.take()]))
        case "takeEvents":
            let name = payload["name"] as? String ?? ""
            callback(.success(["events": EventInbox.shared.take(name)]))
        case "openAppSettings":
            Permissions.openAppSettings()
            callback(.success([:]))
        case "openWebWindow", "closeWebWindow", "webWindowPost", "webWindowInject", "webWindowLoad":
            DispatchQueue.main.async { [weak self] in
                guard let windows = self?.viewController?.webWindows else {
                    callback(.failure(WefterError(code: "NO_SCREEN", message: "The app's screen is gone")))
                    return
                }
                let id = payload["id"] as? String ?? ""
                do {
                    switch method {
                    case "openWebWindow": try windows.open(payload)
                    case "closeWebWindow": windows.close(id: id, reason: "app")
                    case "webWindowPost": windows.post(id: id, json: payload["message"] as? String ?? "")
                    case "webWindowInject": windows.inject(id: id, source: payload["source"] as? String ?? "")
                    default: try windows.load(id: id, url: payload["url"] as? String ?? "")
                    }
                    callback(.success([:]))
                } catch {
                    callback(.failure(error))
                }
            }
        case "setBackListening", "backResult", "getSystemBars", "setSystemBars", "getGestures", "setGestures",
             "getSafeArea":
            DispatchQueue.main.async { [weak self] in
                guard let screen = self?.viewController else {
                    callback(.failure(WefterError(code: "NO_SCREEN", message: "The app's screen is gone")))
                    return
                }
                switch method {
                case "setBackListening":
                    screen.backNavigation.setListening(payload["listening"] as? Bool ?? false)
                    callback(.success([:]))
                case "backResult":
                    screen.backNavigation.onResult(
                        id: payload["id"] as? Int ?? -1,
                        handled: payload["handled"] as? Bool ?? false,
                        pending: payload["pending"] as? Bool ?? false
                    )
                    callback(.success([:]))
                case "getSystemBars": callback(.success(screen.systemUI.barsState()))
                case "setSystemBars": callback(.success(screen.systemUI.setBars(payload)))
                case "getGestures": callback(.success(screen.systemUI.gesturesState()))
                case "setGestures": callback(.success(screen.systemUI.setGestures(payload)))
                default: callback(.success(SystemUI.safeArea(of: screen.view)))
                }
            }
        default:
            callback(.failure(WefterError(code: "UNKNOWN_METHOD", message: "No such method: \(method)")))
        }
    }
}
