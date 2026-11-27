import UIKit
import WebKit

/// Browser features a plain `WKWebView` leaves to its app:
///
/// - `alert()`, `confirm()` and `prompt()` as native alerts, where Return chooses OK on a hardware keyboard.
/// - `target="_blank"` links and `window.open()`: the app's own pages open in place, other sites outside the
///   app.
/// - `getUserMedia()`: the app's own pages get the camera and microphone without WebKit asking again after
///   iOS has. The app needs their usage descriptions (`permissions` in `wefter.config.json`); without one the
///   request is denied, and in debug builds the page's console says why.
extension ViewController: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        let ok = UIAlertAction(title: WefterText.get("dialog.ok"), style: .default) { _ in completionHandler() }
        alert.addAction(ok)
        alert.preferredAction = ok
        if !presentOnTop(alert) { completionHandler() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: WefterText.get("dialog.cancel"), style: .cancel) { _ in completionHandler(false) })
        let ok = UIAlertAction(title: WefterText.get("dialog.ok"), style: .default) { _ in completionHandler(true) }
        alert.addAction(ok)
        alert.preferredAction = ok
        if !presentOnTop(alert) { completionHandler(false) }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: WefterText.get("dialog.cancel"), style: .cancel) { _ in completionHandler(nil) })
        let ok = UIAlertAction(title: WefterText.get("dialog.ok"), style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text ?? "")
        }
        alert.addAction(ok)
        alert.preferredAction = ok
        if !presentOnTop(alert) { completionHandler(nil) }
    }

    /// A link or `window.open()` asking for a new window. There is only one: the app's own pages open in
    /// place and other links leave the app.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url else { return nil }
        if isOwnOrigin(url) {
            webView.load(navigationAction.request)
        } else {
            ExternalLinks.open(url, from: self)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        guard isOwnOrigin(origin) else {
            decisionHandler(.prompt)
            return
        }
        var missing: [(feature: String, api: String)] = []
        if type == .camera || type == .cameraAndMicrophone,
           Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") == nil {
            missing.append(("camera", "getUserMedia({ video })"))
        }
        if type == .microphone || type == .cameraAndMicrophone,
           Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") == nil {
            missing.append(("microphone", "getUserMedia({ audio })"))
        }
        guard missing.isEmpty else {
            for (feature, api) in missing {
                Self.warnInConsole(webView, Self.undeclaredPermissionMessage(feature: feature, api: api))
            }
            decisionHandler(.deny)
            return
        }
        decisionHandler(.grant)
    }

    /// Explains in the console that `api` was denied because the app does not declare `feature`.
    static func undeclaredPermissionMessage(feature: String, api: String) -> String {
        "[Wefter] \(api) was denied: the app does not declare the \(feature) permission. Add \"permissions\": "
            + "{ \"\(feature)\": \"<why the app needs it>\" } to wefter.config.json and run wefter sync."
    }

    /// Logs `message` as a warning in the page's console, in debug builds.
    static func warnInConsole(_ webView: WKWebView?, _ message: String) {
        #if DEBUG
        guard let data = try? JSONSerialization.data(withJSONObject: message, options: [.fragmentsAllowed]),
              let literal = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("console.warn(\(literal))")
        #endif
    }
}
