import UIKit
import WebKit

final class ViewController: UIViewController {
    private static let bundledURL = URL(string: "\(AssetSchemeHandler.scheme)://\(AssetSchemeHandler.host)/index.html")!
    private static let splashURL = URL(string: "\(AssetSchemeHandler.scheme)://\(AssetSchemeHandler.host)/splash/index.html")!
    private static let blankURL = URL(string: "about:blank")!
    private static let maxRenderProcessRetries = 3

    private static let splashFadeTransitionSeconds: TimeInterval = 0.2
    // Generous on purpose: the *first* dev-server load after a fresh process start can be
    // waiting on Vite's cold dependency-optimization pass (can easily run past 8s over WiFi with
    // several plugins), not just a dead connection. Firing early here aborts an
    // in-flight-but-fine load and falls back to blank, which — since retrying can hit that same
    // cold-start cost again — was turning into a loop that never let the page finish. This still
    // catches genuinely dead connections far sooner than the multi-minute OS-level TCP hang it
    // replaces.
    private static let devServerLoadTimeoutSeconds: TimeInterval = 25
    private static let devServerRetryIntervalSeconds: TimeInterval = 3

    private static let devServerUnreachableMessage = "Dev server unreachable"

    private var mainWebView: WKWebView!
    private(set) var dispatcher: BridgeDispatcher!
    private var splashWebView: WKWebView?
    private var splashDismissed = false
    private let splashStartTime = Date()

    private var usingDevServer = false
    private var renderProcessCrashCount = 0

    private var devServerWatchdog: DispatchWorkItem?
    private var devServerRetry: DispatchWorkItem?
    private var isForeground = false
    private var devServerUnreachableNotified = false

    private let devServerHost: String? = {
        guard !BuildConfig.devServerURL.isEmpty, let url = URL(string: BuildConfig.devServerURL) else { return nil }
        return url.host
    }()

    private var environmentName: String {
        #if DEBUG
        return "development"
        #else
        return "production"
        #endif
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        mainWebView = makePrimaryWebView()
        installFullBleed(mainWebView, at: 0)

        if BuildConfig.splashEnabled {
            setupSplash()
        }

        loadInitialContent()

        NotificationCenter.default.addObserver(
            self, selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(appWillResignActive),
            name: UIApplication.willResignActiveNotification, object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func appDidBecomeActive() {
        isForeground = true
        retryDevServerIfNeeded()
    }

    @objc private func appWillResignActive() {
        isForeground = false
        devServerRetry?.cancel()
    }

    private func isDevServerBuild() -> Bool {
        #if DEBUG
        return !BuildConfig.devServerURL.isEmpty
        #else
        return false
        #endif
    }

    private func retryDevServerIfNeeded() {
        guard isForeground, isDevServerBuild(), !usingDevServer else { return }
        loadInitialContent(preferDevServer: true)
    }

    private func installFullBleed(_ subview: UIView, at index: Int) {
        subview.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(subview, at: index)
        NSLayoutConstraint.activate([
            subview.topAnchor.constraint(equalTo: view.topAnchor),
            subview.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            subview.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            subview.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    private func makeSchemeAwareConfiguration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AssetSchemeHandler(), forURLScheme: AssetSchemeHandler.scheme)
        return config
    }

    private func makePrimaryWebView() -> WKWebView {
        let config = makeSchemeAwareConfiguration()

        let userContentController = WKUserContentController()

        let envScript = WKUserScript(
            source: "window.__WEFTER_IOS_ENV__ = \(Self.jsStringLiteral(environmentName));",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        userContentController.addUserScript(envScript)
        config.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self

        let newDispatcher = BridgeDispatcher(webView: webView)
        dispatcher = newDispatcher
        GeneratedRegistry.registerAll(dispatcher: newDispatcher, viewController: self)
        newDispatcher.register("__system", module: SystemModule(viewController: self))

        config.userContentController.add(newDispatcher, name: BridgeDispatcher.messageHandlerName)

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        webView.allowsBackForwardNavigationGestures = true

        return webView
    }

    private func setupSplash() {
        let config = makeSchemeAwareConfiguration()
        let splash = WKWebView(frame: .zero, configuration: config)

        installFullBleed(splash, at: 1)
        splash.load(URLRequest(url: Self.splashURL))
        splashWebView = splash

        if BuildConfig.splashWaitForReady {
            dispatcher.subscribeHook("hideSplash") { [weak self] in self?.dismissSplash() }
            DispatchQueue.main.asyncAfter(deadline: .now() + BuildConfig.splashMaxDurationMs / 1000) { [weak self] in
                self?.dismissSplash()
            }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + BuildConfig.splashMinDurationMs / 1000) { [weak self] in
                self?.dismissSplash()
            }
        }
    }

    private func dismissSplash() {
        guard let splash = splashWebView, !splashDismissed else { return }
        splashDismissed = true

        let elapsedMs = Date().timeIntervalSince(splashStartTime) * 1000
        let remainingMs = max(0, BuildConfig.splashMinDurationMs - elapsedMs)
        let fadeSeconds = BuildConfig.splashFadeTransition ? Self.splashFadeTransitionSeconds : 0
        DispatchQueue.main.asyncAfter(deadline: .now() + remainingMs / 1000) { [weak self] in
            UIView.animate(
                withDuration: fadeSeconds,
                animations: { splash.alpha = 0 },
                completion: { _ in
                    splash.removeFromSuperview()
                    self?.splashWebView = nil
                }
            )
        }
    }

    private func loadInitialContent(preferDevServer: Bool = true) {
        #if DEBUG
        let isDevServerBuild = !BuildConfig.devServerURL.isEmpty
        #else
        let isDevServerBuild = false
        #endif

        if preferDevServer, isDevServerBuild, let url = URL(string: BuildConfig.devServerURL) {
            usingDevServer = true
            armDevServerWatchdog()
            mainWebView.load(URLRequest(url: url))
        } else if isDevServerBuild {
            usingDevServer = false
            mainWebView.load(URLRequest(url: Self.blankURL))
        } else {
            usingDevServer = false
            mainWebView.load(URLRequest(url: Self.bundledURL))
        }
    }

    private func armDevServerWatchdog() {
        devServerWatchdog?.cancel()
        let watchdog = DispatchWorkItem { [weak self] in
            guard let self, self.usingDevServer else { return }
            self.handleDevServerUnreachable()
        }
        devServerWatchdog = watchdog
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.devServerLoadTimeoutSeconds, execute: watchdog)
    }

    private func clearDevServerWatchdog() {
        devServerWatchdog?.cancel()
        devServerWatchdog = nil
    }

    private func handleDevServerUnreachable() {
        clearDevServerWatchdog()
        guard usingDevServer else { return }
        usingDevServer = false
        if !devServerUnreachableNotified {
            devServerUnreachableNotified = true
            showDevServerUnreachableMessage()
        }
        mainWebView.stopLoading()
        mainWebView.load(URLRequest(url: Self.blankURL))
        scheduleDevServerRetry()
    }

    private func scheduleDevServerRetry() {
        devServerRetry?.cancel()
        let retry = DispatchWorkItem { [weak self] in self?.retryDevServerIfNeeded() }
        devServerRetry = retry
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.devServerRetryIntervalSeconds, execute: retry)
    }

    private func showDevServerUnreachableMessage() {
        let alert = UIAlertController(title: nil, message: Self.devServerUnreachableMessage, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    private func showRendererDeadFallback() {
        let label = UILabel()
        label.text = "This app isn't working right now.\nPlease close and reopen it."
        label.textAlignment = .center
        label.numberOfLines = 0
        label.font = .systemFont(ofSize: 16)
        installFullBleed(label, at: view.subviews.count)
    }

    private static func jsStringLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else {
            return "\"\""
        }
        return String(data: data, encoding: .utf8) ?? "\"\""
    }
}

extension ViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if usingDevServer {
            clearDevServerWatchdog()
            devServerRetry?.cancel()
            devServerUnreachableNotified = false
        }

        dispatcher.dispatchHook("appReady")
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        let isOwnOrigin =
            (url.scheme == AssetSchemeHandler.scheme && url.host == AssetSchemeHandler.host)
            || (devServerHost != nil && url.host == devServerHost)
        if isOwnOrigin {
            decisionHandler(.allow)
            return
        }

        if url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        #if DEBUG
        let nsError = error as NSError
        let failedHost =
            (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL)?.host
            ?? (nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String).flatMap { URL(string: $0)?.host }

        guard usingDevServer, let failedHost, failedHost == devServerHost else { return }
        handleDevServerUnreachable()
        #endif
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.removeFromSuperview()

        renderProcessCrashCount += 1
        if renderProcessCrashCount > Self.maxRenderProcessRetries {
            showRendererDeadFallback()
            return
        }

        let preferDevServer = usingDevServer
        mainWebView = makePrimaryWebView()
        installFullBleed(mainWebView, at: 0)
        loadInitialContent(preferDevServer: preferDevServer)
    }
}
