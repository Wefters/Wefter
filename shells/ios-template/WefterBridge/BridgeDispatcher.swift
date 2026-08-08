import Foundation
import WebKit

public protocol NativeModule: AnyObject {
    func invoke(method: String, payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws
    func attachEmitter(_ emit: @escaping (String, [String: Any]) -> Void)
}

public extension NativeModule {
    func attachEmitter(_ emit: @escaping (String, [String: Any]) -> Void) {}
}

public final class BridgeDispatcher: NSObject, WKScriptMessageHandler {

    public static let messageHandlerName = "WefterBridge"

    private weak var webView: WKWebView?
    private var modules: [String: NativeModule] = [:]
    private var hookSubscribers: [String: [() -> Void]] = [:]

    public init(webView: WKWebView) {
        self.webView = webView
    }

    public func register(_ name: String, module: NativeModule) {
        modules[name] = module
        module.attachEmitter { [weak self] hookName, data in
            self?.emit(hookName, data)
        }
    }

    public func subscribeHook(_ hookName: String, callback: @escaping () -> Void) {
        hookSubscribers[hookName, default: []].append(callback)
    }

    public func dispatchHook(_ hookName: String) {
        hookSubscribers[hookName]?.forEach { $0() }
    }

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == BridgeDispatcher.messageHandlerName else { return }
        guard let body = message.body as? [String: Any],
              let callId = body["callId"] as? String,
              let plugin = body["plugin"] as? String,
              let method = body["method"] as? String
        else {
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]

        guard let module = modules[plugin] else {
            sendReject(callId, "UNKNOWN_PLUGIN", "No such plugin: \(plugin)")
            return
        }

        do {
            try module.invoke(method: method, payload: payload) { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let value):
                        self?.sendResolve(callId, value)
                    case .failure(let error):
                        let code = (error as? WefterError)?.code ?? "UNKNOWN"
                        self?.sendReject(callId, code, error.localizedDescription)
                    }
                }
            }
        } catch {
            let code = (error as? WefterError)?.code ?? "PLUGIN_THREW"
            sendReject(callId, code, error.localizedDescription)
        }
    }

    public func emit(_ hookName: String, _ data: [String: Any]) {
        let json = jsonString(for: data)
        evaluateOnMain("window.__wefterNative.emit(\(jsStringLiteral(hookName)), \(jsStringLiteral(json)))")
    }

    private func sendResolve(_ callId: String, _ value: Any) {
        let json = jsonString(for: value)
        evaluateOnMain("window.__wefterNative.resolve(\(jsStringLiteral(callId)), \(jsStringLiteral(json)))")
    }

    private func sendReject(_ callId: String, _ code: String, _ message: String) {
        let errorJson = jsonString(for: ["code": code, "message": message])
        evaluateOnMain("window.__wefterNative.reject(\(jsStringLiteral(callId)), \(jsStringLiteral(errorJson)))")
    }

    private func jsonString(for value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else {
            return "null"
        }
        return String(data: data, encoding: .utf8) ?? "null"
    }

    private func jsStringLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else {
            return "\"\""
        }
        return String(data: data, encoding: .utf8) ?? "\"\""
    }

    private func evaluateOnMain(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}
