import UIKit
import WebKit

/// Web windows: a website opened over the app in its own web view, whose pages from the allowed origins can
/// exchange messages with the app's page (see `openWebWindow()` in `@wefterjs/core`). The pages never get the
/// plugin bridge; native code only passes messages between them and the app's page, which answers.
///
/// The window gets the shell's dialogs, downloads and links to other apps. One window is open at a time.
final class WebWindows {
    private weak var presenter: UIViewController?
    /// Sends a `__system:webWindow` event to the app's page.
    private let notify: ([String: Any]) -> Void
    private var current: WebWindowController?

    init(presenter: UIViewController, notify: @escaping ([String: Any]) -> Void) {
        self.presenter = presenter
        self.notify = notify
    }

    /// Opens a window from `__system.openWebWindow`'s payload, closing one already open.
    ///
    /// - Throws: ``WefterError`` `INVALID_PAYLOAD` when the URL is not from the allowed origins, or an origin
    ///   is not `https` (`http://localhost` in debug builds).
    func open(_ options: [String: Any]) throws {
        guard let id = options["id"] as? String,
              let urlString = options["url"] as? String,
              let url = URL(string: urlString)
        else { throw WefterError(code: "INVALID_PAYLOAD", message: "A web window needs an id and a url") }
        let allowOrigins = Set(options["allowOrigins"] as? [String] ?? [])
        for origin in allowOrigins where !Self.isAcceptable(origin) {
            throw WefterError(code: "INVALID_PAYLOAD", message: "Not an https origin: \(origin)")
        }
        guard let origin = Self.origin(of: url), allowOrigins.contains(origin) else {
            throw WefterError(code: "INVALID_PAYLOAD", message: "\(urlString) is not from one of allowOrigins")
        }
        guard let presenter else { throw WefterError(code: "NO_SCREEN", message: "The app's screen is gone") }

        if let open = current { close(id: open.id, reason: "replaced", animated: false) }

        let toolbar = options["toolbar"] as? [String: Any]
        let controller = WebWindowController(
            id: id,
            allowOrigins: allowOrigins,
            outsideLinks: options["outsideLinks"] as? String ?? "external",
            methods: options["methods"] as? [String] ?? [],
            injectScript: options["injectScript"] as? String ?? "",
            ephemeral: options["ephemeral"] as? Bool ?? false,
            desktopMode: options["desktopMode"] as? Bool ?? false,
            title: toolbar?["title"] as? String ?? "",
            showsNavigation: toolbar?["navigation"] as? Bool ?? false,
            notify: notify
        )
        controller.onClose = { [weak self] reason in self?.finish(id: id, reason: reason) }
        current = controller

        let navigation = UINavigationController(rootViewController: controller)
        navigation.setNavigationBarHidden(toolbar == nil, animated: false)
        navigation.modalPresentationStyle = (options["presentation"] as? String) == "sheet" ? .pageSheet : .fullScreen
        navigation.presentationController?.delegate = controller
        presenter.presentOnTop(navigation)
        controller.load(url)
    }

    /// Closes window `id` and tells the app's page why.
    func close(id: String, reason: String, animated: Bool = true) {
        guard let window = current, window.id == id else { return }
        window.navigationController?.presentingViewController?.dismiss(animated: animated)
        finish(id: id, reason: reason)
    }

    /// Passes a message from the app's page to window `id`'s page, if that page is from the allowed origins.
    func post(id: String, json: String) {
        guard let window = current, window.id == id else { return }
        window.receive(json)
    }

    /// Runs `source` in window `id`'s page, if that page is from the allowed origins.
    func inject(id: String, source: String) {
        guard let window = current, window.id == id else { return }
        window.run(source)
    }

    /// Loads `url`, which must be from the allowed origins, in window `id`.
    func load(id: String, url: String) throws {
        guard let window = current, window.id == id else { return }
        guard let target = URL(string: url), window.isAllowed(target) else {
            throw WefterError(code: "INVALID_PAYLOAD", message: "\(url) is not from one of allowOrigins")
        }
        window.load(target)
    }

    private func finish(id: String, reason: String) {
        guard let window = current, window.id == id else { return }
        current = nil
        window.tearDown()
        notify(["id": id, "type": "closed", "reason": reason])
    }

    /// `scheme://host[:port]` of `url`.
    static func origin(of url: URL) -> String? {
        guard let scheme = url.scheme, let host = url.host else { return nil }
        return url.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
    }

    private static func isAcceptable(_ origin: String) -> Bool {
        guard let url = URL(string: origin) else { return false }
        if url.scheme == "https" { return true }
        #if DEBUG
        return url.scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host ?? "")
        #else
        return false
        #endif
    }
}

/// Forwards script messages without the user content controller keeping the window alive.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// One web window: a navigation bar (close, title, back and forward) above the web view.
final class WebWindowController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler,
    UIAdaptivePresentationControllerDelegate
{
    static let messageHandlerName = "wefterWindow"

    let id: String
    private let allowOrigins: Set<String>
    private let outsideLinks: String
    private let injectScript: String
    private let fixedTitle: String
    private let showsNavigation: Bool
    private let notify: ([String: Any]) -> Void
    private let webView: WKWebView
    private lazy var downloads = WebDownloads(presenter: self)
    private var closed = false
    var onClose: ((String) -> Void)?

    init(
        id: String, allowOrigins: Set<String>, outsideLinks: String, methods: [String], injectScript: String,
        ephemeral: Bool, desktopMode: Bool, title: String, showsNavigation: Bool,
        notify: @escaping ([String: Any]) -> Void
    ) {
        self.id = id
        self.allowOrigins = allowOrigins
        self.outsideLinks = outsideLinks
        self.injectScript = injectScript
        self.fixedTitle = title
        self.showsNavigation = showsNavigation
        self.notify = notify

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .audio
        if ephemeral { configuration.websiteDataStore = .nonPersistent() }
        if desktopMode { configuration.defaultWebpagePreferences.preferredContentMode = .desktop }
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.channelScript(allowOrigins: allowOrigins, methods: methods),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.addUserScript(WebDownloads.userScript)
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
        configuration.userContentController.add(WeakMessageHandler(self), name: Self.messageHandlerName)
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = fixedTitle
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            systemItem: .close,
            primaryAction: UIAction { [weak self] _ in self?.closeByUser() }
        )
        navigationItem.leftBarButtonItem?.accessibilityLabel = WefterText.get("webWindow.close")
        if showsNavigation {
            let forward = UIBarButtonItem(
                image: UIImage(systemName: "chevron.forward"),
                primaryAction: UIAction { [weak self] _ in self?.webView.goForward() }
            )
            forward.accessibilityLabel = WefterText.get("webWindow.forward")
            let back = UIBarButtonItem(
                image: UIImage(systemName: "chevron.backward"),
                primaryAction: UIAction { [weak self] _ in self?.webView.goBack() }
            )
            back.accessibilityLabel = WefterText.get("webWindow.back")
            navigationItem.rightBarButtonItems = [forward, back]
        }

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    func load(_ url: URL) {
        loadViewIfNeeded()
        webView.load(URLRequest(url: url))
    }

    func isAllowed(_ url: URL?) -> Bool {
        guard let url, let origin = WebWindows.origin(of: url) else { return false }
        return allowOrigins.contains(origin)
    }

    /// Delivers a message from the app's page.
    func receive(_ json: String) {
        run("window.__wefterWindowReceive && window.__wefterWindowReceive(\(Self.jsString(json)))")
    }

    /// Runs `source` in the page, if it is from the allowed origins.
    func run(_ source: String) {
        guard isAllowed(webView.url) else { return }
        webView.evaluateJavaScript(source, completionHandler: nil)
    }

    func tearDown() {
        closed = true
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.messageHandlerName)
    }

    private func closeByUser() {
        presentingViewController?.dismiss(animated: true)
        finish("user")
    }

    private func finish(_ reason: String) {
        guard !closed else { return }
        onClose?(reason)
    }

    // MARK: Messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageHandlerName, message.frameInfo.isMainFrame, !closed,
              let json = message.body as? String,
              let data = json.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        let origin = BridgeAccess.string(for: message.frameInfo.securityOrigin)
        guard allowOrigins.contains(origin) else { return }
        notify(["id": id, "type": "message", "origin": origin, "message": parsed])
    }

    // MARK: Navigation

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if !isMainFrame || scheme == "about" || scheme == "blob" || scheme == "data" || isAllowed(url) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        if scheme == "http" || scheme == "https" {
            if outsideLinks != "block" { ExternalLinks.open(url, from: self) }
            notify(["id": id, "type": "navigation", "url": url.absoluteString, "handled": outsideLinks == "block" ? "block" : "external"])
        } else {
            ExternalLinks.open(url, from: self)
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?.lowercased()
        decisionHandler(disposition?.hasPrefix("attachment") == true || !navigationResponse.canShowMIMEType ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        downloads.track(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        downloads.track(download)
    }

    /// Runs the app's `injectScript`, shows the page's title and reports the load.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if !injectScript.isEmpty { run(injectScript) }
        if fixedTitle.isEmpty { title = webView.title }
        notify(["id": id, "type": "load", "url": webView.url?.absoluteString ?? "", "title": webView.title ?? ""])
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        presentingViewController?.dismiss(animated: true)
        finish("error")
    }

    // MARK: Dialogs and new windows

    func webView(
        _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: WefterText.get("dialog.ok"), style: .default) { _ in completionHandler() })
        if !presentOnTop(alert) { completionHandler() }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: WefterText.get("dialog.cancel"), style: .cancel) { _ in completionHandler(false) })
        let ok = UIAlertAction(title: WefterText.get("dialog.ok"), style: .default) { _ in completionHandler(true) }
        alert.addAction(ok)
        alert.preferredAction = ok
        if !presentOnTop(alert) { completionHandler(false) }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
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

    /// `target="_blank"` and `window.open()`: allowed pages load in this window, others go outside.
    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if isAllowed(url) {
            webView.load(navigationAction.request)
        } else {
            ExternalLinks.open(url, from: self)
        }
        return nil
    }

    // MARK: Sheet

    /// The user swiped the sheet down.
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finish("user")
    }

    // MARK: Helpers

    private static func jsString(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { return "\"\"" }
        return String(data: data, encoding: .utf8) ?? "\"\""
    }

    private static func jsonArray(_ value: [String]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return "[]" }
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    /// Defines `window.__wefterWindow` (used by `@wefterjs/frame`) in pages from the allowed origins.
    private static func channelScript(allowOrigins: Set<String>, methods: [String]) -> String {
        """
        (function () {
          var allowed = \(jsonArray(Array(allowOrigins)));
          var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.\(messageHandlerName);
          if (!handler || window.__wefterWindow || allowed.indexOf(location.origin) < 0) return;
          var listeners = [];
          window.__wefterWindowReceive = function (json) {
            listeners.forEach(function (listener) { listener(json); });
          };
          window.__wefterWindow = {
            methods: \(jsonArray(methods)),
            send: function (json) { handler.postMessage(String(json)); },
            listen: function (listener) { listeners.push(listener); }
          };
        })();
        """
    }
}
