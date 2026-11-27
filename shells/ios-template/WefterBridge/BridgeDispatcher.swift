import Foundation
import WebKit

/// A module JavaScript can call through the bridge. Generated dispatch wrappers adapt plugins to it.
public protocol NativeModule: AnyObject {
    /// Runs `method` with `payload` and reports the result through `callback`, on any thread.
    func invoke(method: String, payload: [String: Any], callback: @escaping (Result<Any, Error>) -> Void) throws
    /// Gives the module a way to send events to JavaScript. Optional.
    func attachEmitter(_ emit: @escaping (String, [String: Any]) -> Void)
}

public extension NativeModule {
    func attachEmitter(_ emit: @escaping (String, [String: Any]) -> Void) {}
}

/// Receives calls from JavaScript, routes them to the registered modules and sends results, errors and
/// events back to the web view.
///
/// Every call is checked against ``BridgeAccess`` with the origin of the frame that made it, so a frame
/// from another site cannot reach plugins it was not granted; results go back to that frame. The dispatcher
/// lives as long as the app's screen; ``attach(_:)`` points it at a new web view after the old one's
/// content process crashed, so plugins are created once.
public final class BridgeDispatcher: NSObject, WKScriptMessageHandler {

    /// Name of the script message handler JavaScript posts calls to.
    public static let messageHandlerName = "WefterBridge"

    private let access: BridgeAccess
    private weak var webView: WKWebView?
    private var modules: [String: NativeModule] = [:]
    private var hookSubscribers: [String: [() -> Void]] = [:]

    init(access: BridgeAccess) {
        self.access = access
    }

    /// The web view the dispatcher talks to.
    public var currentWebView: WKWebView? { webView }

    /// Connects the bridge to `webView`, whose configuration must have this dispatcher as its
    /// ``messageHandlerName`` script message handler.
    func attach(_ webView: WKWebView) {
        self.webView = webView
    }

    /// Registers a module under the name JavaScript uses.
    public func register(_ name: String, module: NativeModule) {
        modules[name] = module
        module.attachEmitter { [weak self] hookName, data in
            self?.emit(hookName, data)
        }
    }

    /// Runs `callback` whenever a lifecycle hook (such as `appReady`) fires.
    public func subscribeHook(_ hookName: String, callback: @escaping () -> Void) {
        hookSubscribers[hookName, default: []].append(callback)
    }

    /// Fires a lifecycle hook.
    public func dispatchHook(_ hookName: String) {
        hookSubscribers[hookName]?.forEach { $0() }
    }

    /// Handles a call from JavaScript. Calls from origins not allowed to use the plugin and unknown plugins
    /// are rejected; errors thrown or returned by the module are sent back with their code and, in debug
    /// builds, the native stack trace.
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
        let frame = message.frameInfo
        let origin = frame.securityOrigin

        guard access.allows(origin, plugin: plugin, method: method) else {
            sendReject(callId, "FORBIDDEN_ORIGIN", "\(BridgeAccess.string(for: origin)) may not call \(plugin).\(method)", to: frame)
            return
        }
        guard let module = modules[plugin] else {
            sendReject(callId, "UNKNOWN_PLUGIN", "No such plugin: \(plugin)", to: frame)
            return
        }

        do {
            try module.invoke(method: method, payload: payload) { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let value):
                        self?.sendResolve(callId, value, to: frame)
                    case .failure(let error):
                        let code = (error as? WefterError)?.code ?? "UNKNOWN"
                        let stack = (error as? WefterError)?.debugStack ?? Thread.callStackSymbols
                        self?.sendReject(callId, code, error.localizedDescription, nativeStack: stack, to: frame)
                    }
                }
            }
        } catch {
            let code = (error as? WefterError)?.code ?? "PLUGIN_THREW"
            let stack = (error as? WefterError)?.debugStack ?? Thread.callStackSymbols
            sendReject(callId, code, error.localizedDescription, nativeStack: stack, to: frame)
        }
    }

    /// Sends an event to JavaScript listeners in the app's page. An event sent before `@wefterjs/core` has
    /// loaded is dropped; use `emit(_:_:hold: true)` in a plugin for events that must wait for a listener.
    public func emit(_ hookName: String, _ data: [String: Any]) {
        let json = jsonString(for: data)
        evaluate(
            "window.__wefterNative && window.__wefterNative.emit(\(jsStringLiteral(hookName)), \(jsStringLiteral(json)))",
            in: nil
        )
    }

    /// Resolves a pending call in the frame that made it.
    private func sendResolve(_ callId: String, _ value: Any, to frame: WKFrameInfo) {
        let json = jsonString(for: value)
        evaluate(
            "window.__wefterNative && window.__wefterNative.resolve(\(jsStringLiteral(callId)), \(jsStringLiteral(json)))",
            in: frame
        )
    }

    /// Rejects a pending call in the frame that made it.
    private func sendReject(_ callId: String, _ code: String, _ message: String, nativeStack: [String]? = nil, to frame: WKFrameInfo) {
        var payload: [String: Any] = ["code": code, "message": message]
        #if DEBUG
        if let nativeStack, !nativeStack.isEmpty {
            payload["nativeStack"] = nativeStack.joined(separator: "\n")
        }
        #endif
        let errorJson = jsonString(for: payload)
        evaluate(
            "window.__wefterNative && window.__wefterNative.reject(\(jsStringLiteral(callId)), \(jsStringLiteral(errorJson)))",
            in: frame
        )
    }

    /// JSON for a value, or `null` when it cannot be serialised.
    private func jsonString(for value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else {
            return "null"
        }
        return String(data: data, encoding: .utf8) ?? "null"
    }

    /// A string as a quoted JavaScript literal.
    private func jsStringLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else {
            return "\"\""
        }
        return String(data: data, encoding: .utf8) ?? "\"\""
    }

    /// Runs a script on the main thread, in `frame` (the main frame when `nil` or the main frame).
    private func evaluate(_ script: String, in frame: WKFrameInfo?) {
        DispatchQueue.main.async { [weak self] in
            guard let webView = self?.webView else { return }
            if let frame, !frame.isMainFrame {
                webView.evaluateJavaScript(script, in: frame, in: .page, completionHandler: nil)
            } else {
                webView.evaluateJavaScript(script, completionHandler: nil)
            }
        }
    }
}
