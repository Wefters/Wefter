import UIKit
import WebKit

/// The status bar, home indicator, gestures and safe area of the app's screen: `systemBars`, `gestures`,
/// `audio` and `text` in `wefter.config.json`, changed at runtime by `setSystemBars()` and `setGestures()`
/// from `@wefterjs/core`. ``ViewController`` reads it for its status bar, home indicator and edge gestures.
final class SystemUI {
    /// CSS the app's pages get while `gestures.longPress` is off. Inputs stay selectable.
    private static let noLongPressCSS =
        "html{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;"
        + "-webkit-tap-highlight-color:transparent}img,a{-webkit-user-drag:none}"
        + "input,textarea,select,[contenteditable],[contenteditable] *{-webkit-user-select:text;user-select:text}"

    /// CSS the app's pages get while `gestures.zoom` is off: no pinch or double-tap zoom.
    private static let noZoomCSS = "html{touch-action:pan-x pan-y}"

    private static let config: [String: Any] = {
        guard let data = BuildConfig.systemUI.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return object
    }()

    private(set) var barsHidden = config["barsHidden"] as? Bool ?? false
    private(set) var icons = config["icons"] as? String ?? "auto"
    /// `"history"`, `"page"` or `"off"` (`false` in JavaScript).
    private(set) var swipeBack = SystemUI.swipeBack(from: config["swipeBack"])
    private(set) var zoom = config["zoom"] as? Bool ?? true
    private(set) var longPress = config["longPress"] as? Bool ?? true
    /// `true`, `false`, or the areas in CSS pixels, which iOS can't protect separately: any protects every edge.
    private(set) var edgeProtection: Any = SystemUI.edgeProtection(from: config["edgeProtection"])

    /// `audio.autoplay`: media may play without a tap. Only read when a web view is created.
    static var autoplay: Bool { config["autoplay"] as? Bool ?? false }
    /// `audio.silentSwitch`: `"auto"`, `"respect"` or `"ignore"`.
    private static var silentSwitch: String { config["silentSwitch"] as? String ?? "auto" }

    /// Called after a setting changed, so the screen and web view apply it.
    var onChange: (() -> Void)?

    /// Whether the system edge gestures wait for a second swipe.
    var defersEdgeGestures: Bool {
        if let on = edgeProtection as? Bool { return on }
        return true
    }

    /// The status bar style for the icon colour; `auto` suits `launchBackground`.
    var statusBarStyle: UIStatusBarStyle {
        switch icons {
        case "dark": return .darkContent
        case "light": return .lightContent
        default:
            let (red, green, blue) = BuildConfig.launchBackground
            let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            return luminance > 0.5 ? .darkContent : .lightContent
        }
    }

    // MARK: Web view

    /// Scripts every page of the app's web view starts with: the safe area as `--wefter-safe-area-*` CSS
    /// variables (from `env(safe-area-inset-*)`), the CSS for gestures that are off, and the audio session.
    func userScripts() -> [WKUserScript] {
        var sources = [uiScript()]
        switch Self.silentSwitch {
        case "respect": sources.append("if (navigator.audioSession) navigator.audioSession.type = 'ambient';")
        case "ignore": sources.append("if (navigator.audioSession) navigator.audioSession.type = 'playback';")
        default: break
        }
        return sources.map { WKUserScript(source: $0, injectionTime: .atDocumentStart, forMainFrameOnly: true) }
    }

    /// Applies the gestures to `webView`: the history swipe, pinch zoom and link previews.
    func apply(to webView: WKWebView) {
        webView.allowsBackForwardNavigationGestures = swipeBack == "history"
        webView.allowsLinkPreview = longPress
        webView.scrollView.pinchGestureRecognizer?.isEnabled = zoom
    }

    /// Applies the CSS for the current settings to the page in `webView`.
    func applyScript(to webView: WKWebView) {
        webView.evaluateJavaScript(uiScript(), completionHandler: nil)
    }

    private func uiScript() -> String {
        let css = (longPress ? "" : Self.noLongPressCSS) + (zoom ? "" : Self.noZoomCSS)
        return """
        (function (css) {
          var root = document.documentElement;
          if (!root) return;
          ["top", "right", "bottom", "left"].forEach(function (key) {
            root.style.setProperty("--wefter-safe-area-" + key, "env(safe-area-inset-" + key + ")");
          });
          var style = document.getElementById("__wefter-ui");
          if (!css) { if (style) style.remove(); return; }
          if (!style) { style = document.createElement("style"); style.id = "__wefter-ui"; (document.head || root).appendChild(style); }
          style.textContent = css;
        })(\(Self.jsonLiteral(css)));
        """
    }

    // MARK: `__system` methods

    func setBars(_ payload: [String: Any]) -> [String: Any] {
        if let hidden = payload["hidden"] as? Bool { barsHidden = hidden }
        if let value = payload["icons"] as? String, ["auto", "dark", "light"].contains(value) { icons = value }
        onChange?()
        return barsState()
    }

    func barsState() -> [String: Any] {
        ["hidden": barsHidden, "icons": icons, "supported": ["hidden": true, "icons": true]]
    }

    func setGestures(_ payload: [String: Any]) -> [String: Any] {
        if payload.keys.contains("swipeBack") { swipeBack = Self.swipeBack(from: payload["swipeBack"]) }
        if let value = payload["zoom"] as? Bool { zoom = value }
        if let value = payload["longPress"] as? Bool { longPress = value }
        if payload.keys.contains("edgeProtection") { edgeProtection = Self.edgeProtection(from: payload["edgeProtection"]) }
        onChange?()
        return gesturesState()
    }

    func gesturesState() -> [String: Any] {
        [
            "swipeBack": swipeBack == "off" ? false : swipeBack,
            "zoom": zoom,
            "longPress": longPress,
            // iOS never stretches the app's page, which stays fixed to the screen.
            "overscroll": false,
            "edgeProtection": edgeProtection,
            "supported": [
                "swipeBack": true, "zoom": true, "longPress": true, "overscroll": false, "edgeProtection": true,
            ],
        ]
    }

    static func safeArea(of view: UIView) -> [String: Any] {
        let insets = view.safeAreaInsets
        return ["top": insets.top, "right": insets.right, "bottom": insets.bottom, "left": insets.left]
    }

    // MARK: Parsing

    private static func swipeBack(from value: Any?) -> String {
        if let bool = value as? Bool, !bool { return "off" }
        if let string = value as? String, ["history", "page"].contains(string) { return string }
        return "history"
    }

    private static func edgeProtection(from value: Any?) -> Any {
        if let areas = value as? [Any] { return areas }
        return value as? Bool ?? false
    }

    private static func jsonLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else {
            return "\"\""
        }
        return String(data: data, encoding: .utf8) ?? "\"\""
    }
}
