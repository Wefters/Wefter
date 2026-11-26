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
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.ColorUtils
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader
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
/** How often the web renderer may crash before giving up and showing a fallback message. */
private const val MAX_RENDER_PROCESS_RETRIES = 3

private const val SPLASH_FADE_TRANSITION_MS = 200L
/** How long to wait for the dev server before treating it as unreachable. */
private const val DEV_SERVER_LOAD_TIMEOUT_MS = 25000L
/** Delay between attempts to reconnect to the dev server. */
private const val DEV_SERVER_RETRY_INTERVAL_MS = 3000L

/** Only the app's own code may run; images and network requests may also use HTTPS. */
private const val CONTENT_SECURITY_POLICY =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:;"

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
    private var splashOverlay: WebView? = null
    private var splashDismissed = false
    /** When the splash page finished loading, so its minimum duration counts from when it is on screen. */
    private var splashShownAt: Long? = null

    /** `launchBackground` from `wefter.config.json`, shown until the pages have painted. */
    private val launchBackground by lazy { getColor(R.color.splashBackground) }

    private var usingDevServer = false
    private var renderProcessCrashCount = 0

    private val handler = Handler(Looper.getMainLooper())
    private var devServerWatchdog: Runnable? = null
    private var devServerRetry: Runnable? = null
    private var isForeground = false
    private var devServerUnreachableNotified = false

    /**
     * Sets up edge-to-edge drawing, system bar colours that suit the launch background, the asset loader,
     * the web view and splash, then loads the app. Back navigates inside the web view before leaving the
     * app. A fresh start passes its launch link (if any) to [DeepLinkInbox]; a recreated activity (after a
     * configuration change) keeps the links it already had.
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

        WindowCompat.setDecorFitsSystemWindows(window, false)

        root = FrameLayout(this)
        setContentView(root)

        val backgroundLuminance = ColorUtils.calculateLuminance(getColor(R.color.splashBackground))
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = backgroundLuminance > 0.5
            isAppearanceLightNavigationBars = backgroundLuminance > 0.5
        }

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

        webView = createPrimaryWebView()
        root.addView(
                webView,
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        )

        if (BuildConfig.SPLASH_ENABLED) {
            setupSplash()
        }

        loadInitialContent()

        onBackPressedDispatcher.addCallback(
                this,
                object : OnBackPressedCallback(true) {
                    override fun handleOnBackPressed() {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                }
        )
    }

    /** A link opened while the app is running. `singleTask` routes it here instead of a new activity. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deepLinkFrom(intent)?.let { DeepLinkInbox.receive(it) }
    }

    /** Stops telling this activity's web view about new links. */
    override fun onDestroy() {
        DeepLinkInbox.setListener(null)
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

    /** Passes permission results to the plugin that asked. */
    override fun onRequestPermissionsResult(
            requestCode: Int,
            permissions: Array<out String>,
            grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        dispatcher.handlePermissionResult(requestCode, grantResults)
    }

    /** Retries the dev server when the app returns to the foreground. */
    override fun onResume() {
        super.onResume()
        isForeground = true
        if (isDevServerBuild() && !usingDevServer) {
            loadInitialContent(preferDevServer = true)
        }
    }

    /** Pauses dev server retries in the background. */
    override fun onPause() {
        super.onPause()
        isForeground = false
        devServerRetry?.let { handler.removeCallbacks(it) }
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
     * Creates the main web view and its bridge: registers the plugins and the `__system` module, tells the
     * page about incoming deep links, and exposes the dispatcher to JavaScript.
     */
    private fun createPrimaryWebView(): WebView {
        val newWebView = WebView(this)
        newWebView.settings.javaScriptEnabled = true
        newWebView.setBackgroundColor(launchBackground)

        newWebView.webViewClient =
                object : WebViewClient() {
                    override fun shouldInterceptRequest(
                            view: WebView,
                            request: WebResourceRequest
                    ) = interceptWithCsp(request)

                    /**
                     * A page finished loading: the dev server is reachable again, and plugins get the
                     * `appReady` hook. The web view's own background goes back to white, so pages without
                     * a background of their own show white as in a browser.
                     */
                    override fun onPageFinished(view: WebView, url: String) {
                        view.setBackgroundColor(Color.WHITE)

                        if (usingDevServer) {
                            clearDevServerWatchdog()
                            devServerRetry?.let { handler.removeCallbacks(it) }
                            devServerUnreachableNotified = false
                        }

                        dispatcher.dispatchHook("appReady")
                    }

                    /**
                     * Keeps navigation inside the app's own origin (bundled or dev server); other web links
                     * open in the
                     * browser.
                     */
                    override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest
                    ): Boolean {
                        val host = request.url.host
                        val isOwnOrigin =
                                host == ASSETS_ORIGIN ||
                                        (devServerHost != null && host == devServerHost)
                        if (isOwnOrigin) return false

                        val scheme = request.url.scheme
                        if (scheme == "http" || scheme == "https") {
                            try {
                                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                            } catch (e: ActivityNotFoundException) {}
                        }
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

        dispatcher = BridgeDispatcher(newWebView)
        GeneratedRegistry.registerAll(this, dispatcher)
        /**
         * Built-in module used by `@wefterjs/core`: debug flag, device info, the app-ready and hide-splash
         * signals, the current orientation and deep links (from [DeepLinkInbox]).
         */
        dispatcher.register(
                "__system",
                object : NativeModule {
                    override fun invoke(
                            method: String,
                            payload: JSONObject,
                            callback: (Result<Any>) -> Unit
                    ) {
                        when (method) {
                            "isDebug" -> {
                                val result = JSONObject()
                                result.put("debug", BuildConfig.DEBUG)
                                callback(Result.success(result))
                            }
                            "getDeviceInfo" -> {
                                val result = JSONObject()
                                result.put("platform", "android")
                                result.put("osVersion", android.os.Build.VERSION.RELEASE)
                                callback(Result.success(result))
                            }
                            "appReady" -> {
                                dispatcher.dispatchHook("appReady")
                                callback(Result.success(JSONObject()))
                            }
                            "hideSplash" -> {
                                dispatcher.dispatchHook("hideSplash")
                                callback(Result.success(JSONObject()))
                            }
                            "isLandscape" -> {
                                val isLandscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
                                val result = JSONObject()
                                result.put("landscape", isLandscape)
                                callback(Result.success(result))
                            }
                            "getLaunchUrl" -> {
                                val result = JSONObject()
                                result.put("url", DeepLinkInbox.launchUrl ?: JSONObject.NULL)
                                callback(Result.success(result))
                            }
                            "takeDeepLinks" -> {
                                val result = JSONObject()
                                result.put("links", DeepLinkInbox.take())
                                callback(Result.success(result))
                            }
                            else -> callback(Result.failure(Exception("Unknown method: $method")))
                        }
                    }
                }
        )
        newWebView.addJavascriptInterface(dispatcher, "AndroidBridge")
        val linkDispatcher = dispatcher
        DeepLinkInbox.setListener { linkDispatcher.emit("__system:deepLink", JSONObject()) }

        return newWebView
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
                    it.text = "This app isn't working right now.\nPlease close and reopen it."
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
