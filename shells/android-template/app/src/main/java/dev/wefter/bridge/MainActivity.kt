package dev.wefter.bridge

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Origin the bundled web app is served from by `WebViewAssetLoader`, giving it a real HTTPS origin. The
 * `www` assets folder is its root, as on iOS (`app://local/`), so root-relative URLs such as the
 * `/assets/index.js` a Vite build writes resolve.
 */
private const val ASSETS_ORIGIN = "appassets.androidplatform.net"
private const val BUNDLED_URL = "https://$ASSETS_ORIGIN/index.html"
private const val SPLASH_URL = "https://$ASSETS_ORIGIN/splash/index.html"
private const val BLANK_URL = "about:blank"
/** Schemes a frame inside the page may load in place. */
private val FRAME_SCHEMES = setOf("http", "https", "about", "data", "blob")
/** How often the web renderer may crash before giving up and showing a fallback message. */
private const val MAX_RENDER_PROCESS_RETRIES = 3

private const val SPLASH_FADE_TRANSITION_MS = 200L
/** How long to wait for the dev server before treating it as unreachable. */
private const val DEV_SERVER_LOAD_TIMEOUT_MS = 25000L
/** Delay between attempts to reconnect to the dev server. */
private const val DEV_SERVER_RETRY_INTERVAL_MS = 3000L

/**
 * Only the app's own code may run. Images, audio, video and network requests may also use HTTPS, and
 * `blob:` and `data:` URLs the page makes itself (previews of picked files, downloads it creates). Frames
 * may show the app's own pages and the sites `frames.allow` in `wefter.config.json` lists.
 */
private val CONTENT_SECURITY_POLICY =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; " +
                "connect-src 'self' data: blob: https:; font-src 'self' data:; " +
                "frame-src 'self'${BuildConfig.FRAME_SOURCES.let { if (it.isBlank()) "" else " $it" }};"

/**
 * The app's only screen: a full-screen web view running the web app, an optional splash web view on top,
 * and the bridge to native plugins.
 *
 * In a `--watch` debug build the page is loaded from the dev server; otherwise from the bundled assets. If
 * the dev server cannot be reached, a message is shown and the connection is retried while the app is in
 * the foreground.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var root: FrameLayout
    private lateinit var assetLoader: WebViewAssetLoader
    private var devServerHost: String? = null

    private lateinit var webView: WebView
    private lateinit var dispatcher: BridgeDispatcher
    /** The plugins, created once for this screen and told about its lifecycle. */
    private var plugins: List<WefterPlugin> = emptyList()
    /** Whether this device's web view is too old to run the app safely (see [showWebViewUpdateScreen]). */
    private var webViewTooOld = false
    private var splashOverlay: WebView? = null
    private var splashDismissed = false
    /** When the splash page finished loading, so its minimum duration counts from when it is on screen. */
    private var splashShownAt: Long? = null

    /** `launchBackground` from `wefter.config.json`, shown until the pages have painted. */
    private val launchBackground by lazy { getColor(R.color.splashBackground) }

    private var usingDevServer = false
    private var renderProcessCrashCount = 0

    private lateinit var runtimePermissions: RuntimePermissions
    private lateinit var chromeClient: WefterChromeClient
    private lateinit var downloads: WebDownloads
    private lateinit var geolocation: WebGeolocation
    private lateinit var webWindows: WebWindows
    private lateinit var systemUI: SystemUI
    private lateinit var backNavigation: BackNavigation
    /** Whether the download script must run after each page load (web views without document start scripts). */
    private var injectDownloadScriptAfterLoad = false
    /** Whether the geolocation script must run after each page load, likewise. */
    private var injectGeolocationScriptAfterLoad = false

    private val handler = Handler(Looper.getMainLooper())
    private var devServerWatchdog: Runnable? = null
    private var devServerRetry: Runnable? = null
    private var isForeground = false
    private var devServerUnreachableNotified = false

    /**
     * Sets up edge-to-edge drawing, the system bars and gestures ([SystemUI]), back ([BackNavigation]), the
     * asset loader, the web view and splash, then loads the app. A fresh start passes its launch link (if any) to [DeepLinkInbox]; a recreated activity (after a
     * configuration change) keeps the links it already had and reopens the page it was on, without the
     * splash. Rotation and resizing do not recreate it (see `configChanges` in the manifest).
     */
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        if (savedInstanceState == null) {
            DeepLinkInbox.launch(deepLinkFrom(intent))
        }

        if (BuildConfig.LANDSCAPE) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
        OrientationLock.attach(this)

        WindowCompat.setDecorFitsSystemWindows(window, false)

        root = FrameLayout(this)
        setContentView(root)

        if (!isWebViewSupported()) {
            webViewTooOld = true
            showWebViewUpdateScreen()
            return
        }

        systemUI =
                SystemUI(this, root, launchBackground) { area ->
                    dispatcher.emit("__system:safeArea", area)
                }
        systemUI.attach()
        backNavigation =
                BackNavigation(this, { if (::webView.isInitialized) webView else null }) { event ->
                    dispatcher.emit("__system:back", event)
                }
        backNavigation.attach()

        val bundledAssets = WebViewAssetLoader.AssetsPathHandler(this)
        assetLoader =
                WebViewAssetLoader.Builder()
                        .addPathHandler("/") { path -> bundledAssets.handle("www/${path.ifEmpty { "index.html" }}") }
                        .build()

        devServerHost =
                if (BuildConfig.DEV_SERVER_URL.isNotEmpty())
                        Uri.parse(BuildConfig.DEV_SERVER_URL).host
                else null

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        runtimePermissions = RuntimePermissions(this)
        dispatcher =
                BridgeDispatcher(
                        BridgeAccess(ownOrigins(), BridgeAccess.parseGrants(BuildConfig.FRAME_PLUGIN_GRANTS)),
                        environment = BuildConfig.FLAVOR
                )
        dispatcher.permissions = runtimePermissions
        plugins = GeneratedRegistry.registerAll(this, dispatcher)
        registerSystemModule()
        DeepLinkInbox.setListener { dispatcher.emit("__system:deepLink", JSONObject()) }
        EventInbox.setListener { name -> dispatcher.emit("__system:events", JSONObject().put("name", name)) }

        chromeClient =
                WefterChromeClient(
                        activity = this,
                        permissions = runtimePermissions,
                        fullscreenContainer = root,
                        webView = { webView },
                        isOwnOrigin = ::isOwnOrigin,
                        onFullscreenChange = systemUI::setFullscreen
                )
        downloads = WebDownloads(this)
        geolocation = WebGeolocation(this)
        // A second chrome client for web windows: it registers a result launcher, which Android only allows
        // before the activity starts.
        val windowChromeClient =
                WefterChromeClient(
                        activity = this,
                        permissions = runtimePermissions,
                        fullscreenContainer = root,
                        webView = { webWindows.webView ?: webView },
                        isOwnOrigin = ::isOwnOrigin,
                        onFullscreenChange = systemUI::setFullscreen
                )
        webWindows =
                WebWindows(this, root, windowChromeClient, downloads, systemUI::setWindowIcons) { event ->
                    dispatcher.emit("__system:webWindow", event)
                }

        webView = createPrimaryWebView()
        root.addView(
                webView,
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        )

        val restored = savedInstanceState != null && restoreWebViewState(savedInstanceState)

        if (BuildConfig.SPLASH_ENABLED && !restored) {
            setupSplash()
        }

        if (!restored) {
            loadInitialContent()
        }
        backNavigation.update()
    }

    /**
     * The app opened again while running: `singleTask` routes it here instead of a new activity. Plugins
     * see it first (a notification tap, for example); if none handles it, a link in it is a deep link.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (plugins.any { it.onNewIntent(intent) }) return
        deepLinkFrom(intent)?.let { DeepLinkInbox.receive(it) }
    }

    /**
     * Saves the web view's history, so an activity Android recreates anyway (a language or font size change,
     * or the app's process stopped in the background) reopens the page the user was on.
     */
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (!webViewTooOld && ::webView.isInitialized) {
            webView.saveState(outState)
        }
    }

    /**
     * Restores the history saved by [onSaveInstanceState], reloading the page the user was on. Only bundled
     * builds restore: a dev server build loads the dev server again, so its connection checks run.
     *
     * @return Whether a page was restored.
     */
    private fun restoreWebViewState(savedInstanceState: Bundle): Boolean {
        if (isDevServerBuild()) return false
        return webView.restoreState(savedInstanceState)?.let { it.size > 0 } ?: false
    }

    /** Stops telling this activity's web view about new links and events, and tells the plugins. */
    override fun onDestroy() {
        DeepLinkInbox.setListener(null)
        EventInbox.setListener(null)
        if (::webWindows.isInitialized) webWindows.closeAll()
        plugins.forEach { it.onDestroy() }
        super.onDestroy()
    }

    /**
     * The URL of a `VIEW` intent, or `null` for other intents. An intent replayed from the recent apps
     * screen is ignored, since its link was already handled when it first arrived.
     */
    private fun deepLinkFrom(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_VIEW) return null
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return null
        return intent.dataString?.takeIf { it.isNotEmpty() }
    }

    /**
     * Resumes the web view and re-applies the system bars, retries the dev server when the app returns to
     * the foreground, and tells the plugins.
     */
    override fun onResume() {
        super.onResume()
        isForeground = true
        if (webViewTooOld) return
        webView.onResume()
        systemUI.onResume()
        if (isDevServerBuild() && !usingDevServer) {
            loadInitialContent(preferDevServer = true)
        }
        plugins.forEach { it.onResume() }
    }

    /**
     * Pauses the web view (its media, animations and location updates), pauses dev server retries in the
     * background, and tells the plugins. The page still runs; it hears `visibilitychange`.
     */
    override fun onPause() {
        super.onPause()
        isForeground = false
        devServerRetry?.let { handler.removeCallbacks(it) }
        if (!webViewTooOld && ::webView.isInitialized) webView.onPause()
        plugins.forEach { it.onPause() }
    }

    /** Hides the bars again when the app gets the screen back from a dialog or the notification shade. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && !webViewTooOld && ::systemUI.isInitialized) systemUI.onResume()
    }

    /**
     * Whether this device's web view can keep the bridge to the app's own pages: Android System WebView
     * 82 or newer, with origin-checked message channels and scripts that run before a page's own. Older
     * ones are not supported, since they cannot tell the app's pages from other sites.
     */
    private fun isWebViewSupported(): Boolean =
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
                    WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    /** Asks the user to update Android System WebView, with a button to its store page. */
    private fun showWebViewUpdateScreen() {
        val padding = (24 * resources.displayMetrics.density).toInt()
        val layout =
                LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                    setPadding(padding, padding, padding, padding)
                    setBackgroundColor(Color.WHITE)
                }
        layout.addView(
                TextView(this).apply {
                    text = WefterText.get(this@MainActivity, "webview.update.message")
                    gravity = Gravity.CENTER
                    textSize = 16f
                    setTextColor(Color.BLACK)
                }
        )
        layout.addView(
                Button(this).apply {
                    text = WefterText.get(this@MainActivity, "webview.update.button")
                    setOnClickListener { openWebViewStorePage() }
                }
        )
        root.addView(layout, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    private fun openWebViewStorePage() {
        val webViewPackage = "com.google.android.webview"
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$webViewPackage")))
        } catch (_: ActivityNotFoundException) {
            ExternalLinks.open(this, Uri.parse("https://play.google.com/store/apps/details?id=$webViewPackage"))
        }
    }

    /**
     * Whether [uri] is one of the app's own pages: the bundled app, or the dev server in debug builds.
     * Scheme, host and port must all match, so another server on the same host (`localhost:8787` next to
     * the dev server's `localhost:5173`) is not the app's own.
     */
    private fun isOwnOrigin(uri: Uri): Boolean = uri.host != null && BridgeAccess.originOf(uri) in ownOrigins

    /** [ownOrigins()], computed once. */
    private val ownOrigins: Set<String> by lazy { ownOrigins() }

    /** Origins of the app's own pages, as the web view's origin rules write them. */
    private fun ownOrigins(): Set<String> {
        val origins = mutableSetOf("https://$ASSETS_ORIGIN")
        if (BuildConfig.DEBUG && BuildConfig.DEV_SERVER_URL.isNotEmpty()) {
            val devServer = Uri.parse(BuildConfig.DEV_SERVER_URL)
            val port = if (devServer.port != -1) ":${devServer.port}" else ""
            origins += "${devServer.scheme}://${devServer.host}$port"
        }
        return origins
    }

    /** Whether this is a debug build pointed at a dev server. */
    private fun isDevServerBuild(): Boolean =
            BuildConfig.DEBUG && BuildConfig.DEV_SERVER_URL.isNotEmpty()

    /**
     * Shows the splash page over the app. It is dismissed when the app calls `hideSplash()`, or after the
     * minimum duration when it does not wait for the app, and in either case after the maximum duration.
     * Until its page has painted it shows the launch colour instead of white.
     */
    private fun setupSplash() {
        val splash =
                WebView(this).also {
                    it.settings.javaScriptEnabled = true
                    it.setBackgroundColor(launchBackground)
                    it.webViewClient =
                            object : WebViewClient() {
                                override fun shouldInterceptRequest(
                                        view: WebView,
                                        request: WebResourceRequest
                                ) = interceptWithCsp(request)

                                override fun onPageFinished(view: WebView, url: String) {
                                    splashDidAppear()
                                }

                                /** A splash page that cannot load is removed rather than left blank. */
                                override fun onReceivedError(
                                        view: WebView,
                                        request: WebResourceRequest,
                                        error: WebResourceError
                                ) {
                                    if (request.isForMainFrame) dismissSplash(respectingMinimum = false)
                                }

                                /** Removes the splash if its renderer crashes, instead of closing the app. */
                                override fun onRenderProcessGone(
                                        view: WebView,
                                        detail: RenderProcessGoneDetail
                                ): Boolean {
                                    splashDismissed = true
                                    splashOverlay = null
                                    root.removeView(view)
                                    view.destroy()
                                    return true
                                }
                            }
                    it.loadUrl(SPLASH_URL)

                    root.addView(
                            it,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                    )
                }
        splashOverlay = splash

        if (BuildConfig.SPLASH_WAIT_FOR_READY) {
            dispatcher.subscribeHook("hideSplash") { dismissSplash() }
        }
        root.postDelayed(
                { dismissSplash(respectingMinimum = false) },
                BuildConfig.SPLASH_MAX_DURATION_MS
        )
    }

    /**
     * Starts the minimum duration once the splash page has loaded, and the timer when it does not wait for
     * the app.
     */
    private fun splashDidAppear() {
        if (splashShownAt != null || splashDismissed) return
        splashShownAt = System.currentTimeMillis()
        if (!BuildConfig.SPLASH_WAIT_FOR_READY) {
            root.postDelayed({ dismissSplash() }, BuildConfig.SPLASH_MIN_DURATION_MS)
        }
    }

    /** Serves a bundled file through the asset loader, adding the Content Security Policy header. */
    private fun interceptWithCsp(request: WebResourceRequest): WebResourceResponse? {
        val response = assetLoader.shouldInterceptRequest(request.url) ?: return null
        val headers =
                (response.responseHeaders
                        ?: emptyMap()) + mapOf("Content-Security-Policy" to CONTENT_SECURITY_POLICY)
        response.responseHeaders = headers
        return response
    }

    /**
     * Creates the main web view and connects the bridge to it. The plugins and the `__system` module were
     * registered once in `onCreate`, so a web view rebuilt after a renderer crash reuses them.
     */
    private fun createPrimaryWebView(): WebView {
        val newWebView = WebView(this)
        newWebView.settings.javaScriptEnabled = true
        // localStorage and sessionStorage, which a plain web view leaves off.
        newWebView.settings.domStorageEnabled = true
        newWebView.setBackgroundColor(launchBackground)
        newWebView.webChromeClient = chromeClient
        injectDownloadScriptAfterLoad = downloads.attach(newWebView, ownOrigins(), ::isOwnOrigin)
        injectGeolocationScriptAfterLoad = geolocation.attach(newWebView, ownOrigins())
        systemUI.configure(newWebView, ownOrigins())

        newWebView.webViewClient =
                object : WebViewClient() {
                    override fun shouldInterceptRequest(
                            view: WebView,
                            request: WebResourceRequest
                    ) = interceptWithCsp(request)

                    /** A new page started: it registers its own back listeners. */
                    override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                        backNavigation.onPageStarted()
                    }

                    /** Back is enabled once there is history to go back to. */
                    override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                        backNavigation.update()
                    }

                    /** The new page is about to show: it gets the safe area and gesture CSS. */
                    override fun onPageCommitVisible(view: WebView, url: String) {
                        if (isOwnOrigin(Uri.parse(url))) systemUI.onPageCommitted(view)
                    }

                    /**
                     * A page finished loading: the dev server is reachable again, and plugins get the
                     * `appReady` hook. The web view's own background goes back to white, so pages without
                     * a background of their own show white as in a browser.
                     */
                    override fun onPageFinished(view: WebView, url: String) {
                        view.setBackgroundColor(Color.WHITE)
                        if (isOwnOrigin(Uri.parse(url))) {
                            if (injectDownloadScriptAfterLoad) downloads.injectInto(view)
                            if (injectGeolocationScriptAfterLoad) geolocation.injectInto(view)
                        }

                        if (usingDevServer) {
                            clearDevServerWatchdog()
                            devServerRetry?.let { handler.removeCallbacks(it) }
                            devServerUnreachableNotified = false
                        }

                        dispatcher.dispatchHook("appReady")
                    }

                    /**
                     * Keeps navigation inside the app's own origin (bundled or dev server). Other web pages
                     * open in the browser, and `tel:`, `mailto:`, `sms:`, `intent:` and other app links in
                     * their apps (see [ExternalLinks]). Frames inside a page load in place.
                     */
                    override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest
                    ): Boolean {
                        val url = request.url
                        if (isOwnOrigin(url)) return false
                        val scheme = url.scheme?.lowercase()
                        if (!request.isForMainFrame && scheme in FRAME_SCHEMES) return false
                        if (scheme == "about") return false

                        ExternalLinks.open(this@MainActivity, url)
                        return true
                    }

                    /**
                     * Treats a failed main-frame load of the dev server as unreachable (debug builds only).
                     */
                    override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            error: WebResourceError
                    ) {
                        if (BuildConfig.DEBUG &&
                                        usingDevServer &&
                                        request.isForMainFrame &&
                                        request.url.host == devServerHost
                        ) {
                            handleDevServerUnreachable()
                        }
                    }

                    /** Replaces the web view after its renderer crashes, up to a limit. */
                    override fun onRenderProcessGone(
                            view: WebView,
                            detail: RenderProcessGoneDetail
                    ): Boolean {
                        root.removeView(view)
                        view.destroy()

                        renderProcessCrashCount++
                        if (renderProcessCrashCount > MAX_RENDER_PROCESS_RETRIES) {
                            showRendererDeadFallback()
                        } else {
                            webView = createPrimaryWebView()
                            root.addView(
                                    webView,
                                    0,
                                    ViewGroup.LayoutParams(
                                            ViewGroup.LayoutParams.MATCH_PARENT,
                                            ViewGroup.LayoutParams.MATCH_PARENT
                                    )
                            )
                            loadInitialContent(preferDevServer = usingDevServer)
                        }
                        return true
                    }
                }

        dispatcher.attach(newWebView)

        return newWebView
    }

    /**
     * Registers the built-in `__system` module used by `@wefterjs/core`: debug flag, device info, the
     * app-ready and hide-splash signals, the current orientation, deep links (from [DeepLinkInbox]), held
     * plugin events (from [EventInbox]), the app's settings page, web windows, back ([BackNavigation]) and
     * the system bars, gestures and safe area ([SystemUI]). Only the app's own pages reach it.
     */
    private fun registerSystemModule() {
        dispatcher.register(
                "__system",
                object : NativeModule {
                    override fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit) {
                        when (method) {
                            "isDebug" -> callback(Result.success(JSONObject().put("debug", BuildConfig.DEBUG)))
                            "getDeviceInfo" ->
                                    callback(
                                            Result.success(
                                                    JSONObject()
                                                            .put("platform", "android")
                                                            .put("osVersion", android.os.Build.VERSION.RELEASE)
                                            )
                                    )
                            "appReady", "hideSplash" ->
                                    runOnUiThread {
                                        dispatcher.dispatchHook(method)
                                        callback(Result.success(JSONObject()))
                                    }
                            "isLandscape" -> {
                                val isLandscape =
                                        resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
                                callback(Result.success(JSONObject().put("landscape", isLandscape)))
                            }
                            "getLaunchUrl" ->
                                    callback(
                                            Result.success(
                                                    JSONObject().put("url", DeepLinkInbox.launchUrl ?: JSONObject.NULL)
                                            )
                                    )
                            "takeDeepLinks" -> callback(Result.success(JSONObject().put("links", DeepLinkInbox.take())))
                            "takeEvents" -> {
                                val name = payload.optString("name")
                                callback(Result.success(JSONObject().put("events", EventInbox.take(name))))
                            }
                            "openAppSettings" ->
                                    runOnUiThread {
                                        runtimePermissions.openAppSettings()
                                        callback(Result.success(JSONObject()))
                                    }
                            "openWebWindow", "closeWebWindow", "webWindowPost", "webWindowInject", "webWindowLoad" ->
                                    runOnUiThread { callback(handleWebWindowCall(method, payload)) }
                            "setBackListening" ->
                                    runOnUiThread {
                                        backNavigation.setListening(payload.optBoolean("listening"))
                                        callback(Result.success(JSONObject()))
                                    }
                            "backResult" ->
                                    runOnUiThread {
                                        backNavigation.onResult(
                                                payload.optInt("id"),
                                                payload.optBoolean("handled"),
                                                payload.optBoolean("pending")
                                        )
                                        callback(Result.success(JSONObject()))
                                    }
                            "getSystemBars" -> runOnUiThread { callback(Result.success(systemUI.barsState())) }
                            "setSystemBars" -> runOnUiThread { callback(Result.success(systemUI.setBars(payload))) }
                            "getGestures" -> runOnUiThread { callback(Result.success(systemUI.gesturesState())) }
                            "setGestures" -> runOnUiThread { callback(Result.success(systemUI.setGestures(payload))) }
                            "getSafeArea" -> runOnUiThread { callback(Result.success(systemUI.safeAreaState())) }
                            else ->
                                    callback(
                                            Result.failure(WefterError("UNKNOWN_METHOD", "No such method: $method"))
                                    )
                        }
                    }
                }
        )
    }

    /** Runs a web window method of `__system` (see [WebWindows]). Must run on the main thread. */
    private fun handleWebWindowCall(method: String, payload: JSONObject): Result<Any> =
            try {
                val id = payload.optString("id")
                when (method) {
                    "openWebWindow" -> webWindows.open(payload)
                    "closeWebWindow" -> webWindows.close(id, "app")
                    "webWindowPost" -> webWindows.post(id, payload.optString("message"))
                    "webWindowInject" -> webWindows.inject(id, payload.optString("source"))
                    "webWindowLoad" -> webWindows.load(id, payload.optString("url"))
                }
                Result.success(JSONObject())
            } catch (e: IllegalArgumentException) {
                Result.failure(WefterError("INVALID_PAYLOAD", e.message ?: "Invalid web window options"))
            }

    /**
     * Loads the dev server when this build uses one, else the bundled app. A dev server build that is not
     * connected shows a blank page instead of stale bundled assets.
     */
    private fun loadInitialContent(preferDevServer: Boolean = true) {
        val devServerUrl = BuildConfig.DEV_SERVER_URL
        val isDevServerBuild = BuildConfig.DEBUG && devServerUrl.isNotEmpty()
        when {
            preferDevServer && isDevServerBuild -> {
                usingDevServer = true
                armDevServerWatchdog()
                webView.loadUrl(devServerUrl)
            }
            isDevServerBuild -> {
                usingDevServer = false
                webView.loadUrl(BLANK_URL)
            }
            else -> {
                usingDevServer = false
                webView.loadUrl(BUNDLED_URL)
            }
        }
    }

    /** Treats the dev server as unreachable if the page has not loaded in time. */
    private fun armDevServerWatchdog() {
        devServerWatchdog?.let { handler.removeCallbacks(it) }
        val watchdog = Runnable { if (usingDevServer) handleDevServerUnreachable() }
        devServerWatchdog = watchdog
        handler.postDelayed(watchdog, DEV_SERVER_LOAD_TIMEOUT_MS)
    }

    /** Cancels the dev server load timeout. */
    private fun clearDevServerWatchdog() {
        devServerWatchdog?.let { handler.removeCallbacks(it) }
        devServerWatchdog = null
    }

    /** Shows the "unreachable" message once, clears the page and schedules a retry. */
    private fun handleDevServerUnreachable() {
        clearDevServerWatchdog()
        if (!usingDevServer) return
        usingDevServer = false
        if (!devServerUnreachableNotified) {
            devServerUnreachableNotified = true
            Toast.makeText(this, "Dev server unreachable", Toast.LENGTH_SHORT).show()
        }
        webView.stopLoading()
        webView.loadUrl(BLANK_URL)
        scheduleDevServerRetry()
    }

    /** Tries the dev server again after a short delay, if the app is still in the foreground. */
    private fun scheduleDevServerRetry() {
        devServerRetry?.let { handler.removeCallbacks(it) }
        val retry = Runnable {
            if (isForeground && isDevServerBuild() && !usingDevServer) {
                loadInitialContent(preferDevServer = true)
            }
        }
        devServerRetry = retry
        handler.postDelayed(retry, DEV_SERVER_RETRY_INTERVAL_MS)
    }

    /** Shown when the web renderer keeps crashing. */
    private fun showRendererDeadFallback() {
        val message =
                TextView(this).also {
                    it.text = WefterText.get(this, "app.crashed")
                    it.gravity = Gravity.CENTER
                    it.textSize = 16f
                    it.setTextColor(Color.BLACK)
                    it.setBackgroundColor(Color.WHITE)
                    it.setPadding(48, 48, 48, 48)
                }
        root.addView(
                message,
                ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                )
        )
    }

    /**
     * Fades the splash out and removes it. With `respectingMinimum`, a splash that is on screen first stays
     * for its minimum duration; one that has not appeared yet is removed at once, since the app is ready.
     */
    private fun dismissSplash(respectingMinimum: Boolean = true) {
        val overlay = splashOverlay ?: return
        if (splashDismissed) return
        splashDismissed = true
        val shownAt = splashShownAt
        val remaining =
                if (respectingMinimum && shownAt != null)
                        (BuildConfig.SPLASH_MIN_DURATION_MS - (System.currentTimeMillis() - shownAt))
                                .coerceAtLeast(0)
                else 0L
        val fadeMs = if (BuildConfig.SPLASH_FADE_TRANSITION) SPLASH_FADE_TRANSITION_MS else 0L
        overlay.postDelayed(
                {
                    overlay.animate()
                            .alpha(0f)
                            .setDuration(fadeMs)
                            .withEndAction {
                                root.removeView(overlay)
                                overlay.destroy()
                                splashOverlay = null
                            }
                            .start()
                },
                remaining
        )
    }
}
