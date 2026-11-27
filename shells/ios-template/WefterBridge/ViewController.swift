import UIKit
import WebKit

/// The app's only screen: a full-screen web view running the web app, an optional splash web view on top,
/// and the bridge to native plugins.
///
/// In a `--watch` debug build the page is loaded from the dev server; otherwise from the bundled assets. If
/// the dev server cannot be reached, a message is shown and the connection is retried whenever the app is in
/// the foreground.
final class ViewController: UIViewController {
    private static let bundledURL = URL(string: "\(AssetSchemeHandler.scheme)://\(AssetSchemeHandler.host)/index.html")!
    private static let splashURL = URL(string: "\(AssetSchemeHandler.scheme)://\(AssetSchemeHandler.host)/splash/index.html")!
    private static let blankURL = URL(string: "about:blank")!
    /// Schemes a frame inside the page may load in place.
    private static let frameSchemes: Set<String> = ["http", "https", "about", "data", "blob"]
    /// How often the web content process may crash before giving up and showing a fallback message.
    private static let maxRenderProcessRetries = 3

    private static let splashFadeTransitionSeconds: TimeInterval = 0.2
    /// `launchBackground` from `wefter.config.json`, shown until the pages have painted.
    private static let launchBackground = UIColor(
        red: CGFloat(BuildConfig.launchBackground.red),
        green: CGFloat(BuildConfig.launchBackground.green),
        blue: CGFloat(BuildConfig.launchBackground.blue),
        alpha: 1
    )
    /// How long to wait for the dev server before treating it as unreachable.
    private static let devServerLoadTimeoutSeconds: TimeInterval = 25
    /// Delay between attempts to reconnect to the dev server.
    private static let devServerRetryIntervalSeconds: TimeInterval = 3

    private static let devServerUnreachableMessage = "Dev server unreachable"

    private var mainWebView: WKWebView!
    private(set) var dispatcher: BridgeDispatcher!
    private var splashWebView: WKWebView?
    private var splashDismissed = false
    /// When the splash page finished loading, so its minimum duration counts from when it is on screen.
    private var splashShownAt: Date?
    private let splashNavigationDelegate = SplashNavigationDelegate()
    private lazy var downloads = WebDownloads(presenter: self)
    /// Websites the app opens over itself with `openWebWindow()`.
    private(set) lazy var webWindows = WebWindows(presenter: self) { [weak self] event in
        self?.dispatcher.emit("__system:webWindow", event)
    }

    private var usingDevServer = false
    private var renderProcessCrashCount = 0

    private var devServerWatchdog: DispatchWorkItem?
    private var devServerRetry: DispatchWorkItem?
    private var isForeground = false
    private var devServerUnreachableNotified = false

    /// Host of the dev server, whose pages are allowed to load in the web view.
    private let devServerHost: String? = {
        guard !BuildConfig.devServerURL.isEmpty, let url = URL(string: BuildConfig.devServerURL) else { return nil }
        return url.host
    }()

    /// Scheme, host and port of the dev server: another server on the same host is not the app's own.
    private let devServerOrigin: (scheme: String, host: String, port: Int)? = {
        guard !BuildConfig.devServerURL.isEmpty, let url = URL(string: BuildConfig.devServerURL),
              let scheme = url.scheme?.lowercased(), let host = url.host
        else { return nil }
        return (scheme, host, url.port ?? ViewController.defaultPort(for: scheme))
    }()

    private static func defaultPort(for scheme: String) -> Int {
        scheme == "https" ? 443 : 80
    }

    private func isDevServer(scheme: String?, host: String?, port: Int?) -> Bool {
        guard let devServerOrigin, let scheme = scheme?.lowercased(), let host else { return false }
        return scheme == devServerOrigin.scheme && host == devServerOrigin.host
            && (port ?? Self.defaultPort(for: scheme)) == devServerOrigin.port
    }

    /// Environment name reported to `getPlatformInfo()`.
    private var environmentName: String { WefterFiles.environment }

    /// The app's orientations (`orientation` in `wefter.config.json`), or a lock a plugin set.
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        OrientationLock.shared.supportedOrientations
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.launchBackground

        setUpBridge()
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

    /// Retries the dev server when the app returns to the foreground.
    @objc private func appDidBecomeActive() {
        isForeground = true
        retryDevServerIfNeeded()
    }

    /// Pauses dev server retries in the background.
    @objc private func appWillResignActive() {
        isForeground = false
        devServerRetry?.cancel()
    }

    /// Whether this is a debug build pointed at a dev server.
    private func isDevServerBuild() -> Bool {
        #if DEBUG
        return !BuildConfig.devServerURL.isEmpty
        #else
        return false
        #endif
    }

    /// Tries the dev server again if it is not connected and the app is visible.
    private func retryDevServerIfNeeded() {
        guard isForeground, isDevServerBuild(), !usingDevServer else { return }
        loadInitialContent(preferDevServer: true)
    }

    /// Stops the web view's scroll view from bouncing or adding safe-area insets, so the page stays fixed and
    /// handles scrolling and safe areas itself (`env(safe-area-inset-*)`).
    private static func pinPageToScreen(_ webView: WKWebView) {
        let scrollView = webView.scrollView
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.bounces = false
        scrollView.alwaysBounceVertical = false
        scrollView.alwaysBounceHorizontal = false
    }

    /// Shows the launch colour instead of white while the web view's content process starts and its page
    /// loads, so the launch screen hands over without a white flash.
    private static func showLaunchBackground(in webView: WKWebView) {
        webView.isOpaque = false
        webView.backgroundColor = launchBackground
        webView.scrollView.backgroundColor = launchBackground
    }

    /// Adds a view at `index` that fills the whole screen.
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

    /// A web view configuration that serves `app://local/` from the bundle. Media behaves as in Safari:
    /// videos with `playsinline` play in the page, muted videos may autoplay, and elements can go fullscreen.
    private func makeSchemeAwareConfiguration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AssetSchemeHandler(), forURLScheme: AssetSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .audio
        if #available(iOS 16.4, *) {
            config.preferences.isElementFullscreenEnabled = true
        }
        return config
    }

    /// Whether `url` is one of the app's own pages: the bundled app, or the dev server in debug builds.
    /// Scheme, host and port must all match, so another server on the same host (`localhost:8787` next to
    /// the dev server's `localhost:5173`) is not the app's own.
    func isOwnOrigin(_ url: URL) -> Bool {
        (url.scheme == AssetSchemeHandler.scheme && url.host == AssetSchemeHandler.host)
            || isDevServer(scheme: url.scheme, host: url.host, port: url.port)
    }

    /// Whether `origin` is one of the app's own pages.
    func isOwnOrigin(_ origin: WKSecurityOrigin) -> Bool {
        (origin.protocol == AssetSchemeHandler.scheme && origin.host == AssetSchemeHandler.host)
            || isDevServer(scheme: origin.protocol, host: origin.host, port: origin.port == 0 ? nil : origin.port)
    }

    /// Creates the bridge and the plugins, once for this screen: the `__system` module, deep links and held
    /// plugin events for the page, and ``PluginHost`` for the app's lifecycle.
    private func setUpBridge() {
        let access = BridgeAccess(
            isOwnOrigin: { [weak self] origin in self?.isOwnOrigin(origin) ?? false },
            grants: BuildConfig.framePluginGrants
        )
        let newDispatcher = BridgeDispatcher(access: access)
        dispatcher = newDispatcher
        let plugins = GeneratedRegistry.registerAll(dispatcher: newDispatcher, viewController: self)
        newDispatcher.register("__system", module: SystemModule(viewController: self))
        PluginHost.shared.setPlugins(plugins)
        DeepLinkInbox.shared.setListener { [weak newDispatcher] in
            newDispatcher?.emit("__system:deepLink", [:])
        }
        EventInbox.shared.setListener { [weak newDispatcher] name in
            newDispatcher?.emit("__system:events", ["name": name])
        }
    }

    /// Creates the main web view: injects the environment name, hides the keyboard's form bar unless the
    /// config keeps it, connects the bridge, answers `navigator.geolocation` natively, and enables Safari
    /// inspection in debug builds.
    private func makePrimaryWebView() -> WKWebView {
        let config = makeSchemeAwareConfiguration()

        let userContentController = WKUserContentController()

        let envScript = WKUserScript(
            source: "window.__WEFTER_IOS_ENV__ = \(Self.jsStringLiteral(environmentName));",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        userContentController.addUserScript(envScript)
        userContentController.addUserScript(WebGeolocation.userScript)
        userContentController.addUserScript(WebDownloads.userScript)
        config.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        let geolocation = WebGeolocation(webView: webView) { [weak self] origin in
            self?.isOwnOrigin(origin) ?? false
        }
        userContentController.add(geolocation, name: WebGeolocation.messageHandlerName)
        Self.pinPageToScreen(webView)
        Self.showLaunchBackground(in: webView)
        FormAccessoryBar.apply(to: webView)

        dispatcher.attach(webView)
        config.userContentController.add(dispatcher, name: BridgeDispatcher.messageHandlerName)

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        webView.allowsBackForwardNavigationGestures = true

        return webView
    }

    /// Shows the splash page over the app. It is dismissed when the app calls `hideSplash()`, or after the
    /// minimum duration when it does not wait for the app, and in either case after the maximum duration.
    private func setupSplash() {
        let config = makeSchemeAwareConfiguration()
        let splash = WKWebView(frame: .zero, configuration: config)
        Self.pinPageToScreen(splash)
        Self.showLaunchBackground(in: splash)
        splashNavigationDelegate.onFinish = { [weak self] in self?.splashDidAppear() }
        splashNavigationDelegate.onFail = { [weak self] in self?.dismissSplash(respectingMinimum: false) }
        splash.navigationDelegate = splashNavigationDelegate

        installFullBleed(splash, at: 1)
        splash.load(URLRequest(url: Self.splashURL))
        splashWebView = splash

        if BuildConfig.splashWaitForReady {
            dispatcher.subscribeHook("hideSplash") { [weak self] in self?.dismissSplash() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + BuildConfig.splashMaxDurationMs / 1000) { [weak self] in
            self?.dismissSplash(respectingMinimum: false)
        }
    }

    /// Starts the minimum duration once the splash page has loaded, and the timer when it does not wait for
    /// the app.
    private func splashDidAppear() {
        guard splashShownAt == nil, !splashDismissed else { return }
        splashShownAt = Date()
        if !BuildConfig.splashWaitForReady {
            DispatchQueue.main.asyncAfter(deadline: .now() + BuildConfig.splashMinDurationMs / 1000) { [weak self] in
                self?.dismissSplash()
            }
        }
    }

    /// Fades the splash out. With `respectingMinimum`, a splash that is on screen first stays for its minimum
    /// duration; one that has not appeared yet is removed at once, since the app is already ready.
    private func dismissSplash(respectingMinimum: Bool = true) {
        guard let splash = splashWebView, !splashDismissed else { return }
        splashDismissed = true

        var remainingMs: Double = 0
        if respectingMinimum, let shownAt = splashShownAt {
            remainingMs = max(0, BuildConfig.splashMinDurationMs - Date().timeIntervalSince(shownAt) * 1000)
        }
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

    /// Loads the dev server when this build uses one, else the bundled app. A dev server build that is not
    /// connected shows a blank page instead of stale bundled assets.
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

    /// Treats the dev server as unreachable if the page has not loaded in time.
    private func armDevServerWatchdog() {
        devServerWatchdog?.cancel()
        let watchdog = DispatchWorkItem { [weak self] in
            guard let self, self.usingDevServer else { return }
            self.handleDevServerUnreachable()
        }
        devServerWatchdog = watchdog
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.devServerLoadTimeoutSeconds, execute: watchdog)
    }

    /// Cancels the dev server load timeout.
    private func clearDevServerWatchdog() {
        devServerWatchdog?.cancel()
        devServerWatchdog = nil
    }

    /// Shows the "unreachable" message once, clears the page and schedules a retry.
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

    /// Tries the dev server again after a short delay.
    private func scheduleDevServerRetry() {
        devServerRetry?.cancel()
        let retry = DispatchWorkItem { [weak self] in self?.retryDevServerIfNeeded() }
        devServerRetry = retry
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.devServerRetryIntervalSeconds, execute: retry)
    }

    /// Alerts the developer that the dev server could not be reached.
    private func showDevServerUnreachableMessage() {
        let alert = UIAlertController(title: nil, message: Self.devServerUnreachableMessage, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    /// Shown when the web content keeps crashing.
    private func showRendererDeadFallback() {
        let label = UILabel()
        label.text = WefterText.get("app.crashed")
        label.textAlignment = .center
        label.numberOfLines = 0
        label.font = .systemFont(ofSize: 16)
        label.backgroundColor = .systemBackground
        installFullBleed(label, at: view.subviews.count)
    }

    /// A string as a quoted JavaScript literal.
    private static func jsStringLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else {
            return "\"\""
        }
        return String(data: data, encoding: .utf8) ?? "\"\""
    }
}

extension ViewController: WKNavigationDelegate {
    /// A page finished loading: the dev server is reachable again, and plugins get the `appReady` hook. The
    /// web view becomes opaque again, so pages without a background of their own show white as in a browser.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if !webView.isOpaque {
            webView.isOpaque = true
            webView.backgroundColor = .white
            webView.scrollView.backgroundColor = .white
        }

        if usingDevServer {
            clearDevServerWatchdog()
            devServerRetry?.cancel()
            devServerUnreachableNotified = false
        }

        dispatcher.dispatchHook("appReady")
    }

    /// Keeps navigation inside the app's own origin (bundled or dev server). Other web pages open in Safari,
    /// and `tel:`, `mailto:`, `sms:` and other app links in their apps (see ``ExternalLinks``). Frames
    /// inside a page load in place, and `<a download>` links are downloaded (see ``WebDownloads``).
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
        let isFrame = !(navigationAction.targetFrame?.isMainFrame ?? true)
        if isOwnOrigin(url) || scheme == "about" || (isFrame && Self.frameSchemes.contains(scheme)) {
            decisionHandler(.allow)
            return
        }

        ExternalLinks.open(url, from: self)
        decisionHandler(.cancel)
    }

    /// Downloads responses sent as attachments, or that the web view cannot show.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?
            .lowercased()
        if disposition?.hasPrefix("attachment") == true || !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        downloads.track(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        downloads.track(download)
    }

    /// Treats a failed load of the dev server as unreachable (debug builds only).
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

    /// Recreates the web view after its content process crashes, up to a limit.
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

/// Reports when the splash page has loaded, or could not be shown.
private final class SplashNavigationDelegate: NSObject, WKNavigationDelegate {
    var onFinish: (() -> Void)?
    var onFail: (() -> Void)?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onFinish?()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        onFail?()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        onFail?()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        onFail?()
    }
}
