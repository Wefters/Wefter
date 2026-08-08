
import Foundation
import UIKit

final class DeviceInfoPluginDispatch: NativeModule {
    private let plugin: DeviceInfoPlugin
    init(plugin: DeviceInfoPlugin) { self.plugin = plugin }

    func invoke(method: String, payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        switch method {
        case "getInfo":
            try plugin.getInfo(payload: payload, callback: callback)
        default:
            callback(.failure(WefterError(code: "UNKNOWN_METHOD", message: "No such method: \(method)")))
        }
    }
}

final class PingTestPluginDispatch: NativeModule {
    private let plugin: PingTestPlugin
    init(plugin: PingTestPlugin) { self.plugin = plugin }

    func invoke(method: String, payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws {
        switch method {
        case "ping":
            try plugin.ping(payload: payload, callback: callback)
        default:
            callback(.failure(WefterError(code: "UNKNOWN_METHOD", message: "No such method: \(method)")))
        }
    }
}

enum GeneratedRegistry {
    static func registerAll(dispatcher: BridgeDispatcher, viewController: UIViewController) {
        let deviceInfoPlugin = DeviceInfoPlugin(dispatcher: dispatcher, viewController: viewController)
        dispatcher.register("device-info", module: DeviceInfoPluginDispatch(plugin: deviceInfoPlugin))
        let pingTestPlugin = PingTestPlugin(dispatcher: dispatcher, viewController: viewController)
        dispatcher.register("ping-test", module: PingTestPluginDispatch(plugin: pingTestPlugin))
    }
}
