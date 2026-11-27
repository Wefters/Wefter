package dev.wefter.bridge

import android.annotation.SuppressLint
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject

/** Name of the message channel pages in a web window use to reach the app, `window.WefterWindow`. */
private const val CHANNEL = "WefterWindow"

/**
 * Runs in the web window's pages from its allowed origins. Defines `window.__wefterWindow`, which
 * `@wefterjs/frame` uses: `send` posts a message to the app, `listen` receives the app's, which arrive
 * through `window.__wefterWindowReceive`.
 */
private fun channelScript(methods: JSONArray): String =
        """
(function () {
  var channel = window.$CHANNEL;
  if (!channel || window.__wefterWindow) return;
  var listeners = [];
  window.__wefterWindowReceive = function (json) {
    listeners.forEach(function (listener) { listener(json); });
  };
  window.__wefterWindow = {
    methods: $methods,
    send: function (json) { channel.postMessage(String(json)); },
    listen: function (listener) { listeners.push(listener); }
  };
})();
"""

/**
 * Web windows: a website opened over the app in its own web view, whose pages from the allowed origins can
 * exchange messages with the app's page (see `openWebWindow()` in `@wefterjs/core`). The pages never get the
 * plugin bridge; native code only passes messages between them and the app's page, which answers.
 *
 * The window gets the shell's web features (dialogs, file uploads, downloads, links to other apps); the
 * camera, microphone and location stay with the app's own pages. One window is open at a time.
 */
internal class WebWindows(
        private val activity: AppCompatActivity,
        private val root: FrameLayout,
        private val chromeClient: WefterChromeClient,
        private val downloads: WebDownloads,
        /** Sends a `__system:webWindow` event to the app's page. */
        private val notify: (JSONObject) -> Unit,
) {
    private inner class Window(
            val id: String,
            val allowOrigins: Set<String>,
            val outsideLinks: String,
            val injectScript: String,
            val profile: String?,
            /** Whether the window's bars are light, so the status bar needs dark icons. */
            val lightBars: Boolean,
            /** The status bar icons before the window opened, restored when it closes. */
            val previousLightStatusBar: Boolean,
            val webView: WebView,
            val container: View,
            val titleView: TextView?,
            val back: OnBackPressedCallback,
    )

    private var current: Window? = null

    /** The open window's web view, for the chrome client. */
    val webView: WebView?
        get() = current?.webView

    /**
     * Opens a window from `__system.openWebWindow`'s payload, closing one already open.
     *
     * @throws IllegalArgumentException When the URL is not from the allowed origins, or an origin is not
     *   `https` (`http://localhost` in debug builds).
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun open(options: JSONObject) {
        val id = options.getString("id")
        val url = options.getString("url")
        val allowOrigins = jsonStrings(options.optJSONArray("allowOrigins")).toSet()
        for (origin in allowOrigins) require(isAcceptableOrigin(origin)) { "Not an https origin: $origin" }
        require(BridgeAccess.originOf(Uri.parse(url)) in allowOrigins) { "$url is not from one of allowOrigins" }

        current?.let { close(it.id, "replaced") }

        val profile =
                if (options.optBoolean("ephemeral") && WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
                    "wefter-window-$id".also { ProfileStore.getInstance().getOrCreateProfile(it) }
                } else null

        val webView = WebView(activity)
        profile?.let { WebViewCompat.setProfile(webView, it) }
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        if (options.optBoolean("desktopMode")) {
            webView.settings.useWideViewPort = true
            webView.settings.loadWithOverviewMode = true
            webView.settings.userAgentString = webView.settings.userAgentString.replace(" Mobile", "")
        }
        webView.webChromeClient = chromeClient
        downloads.attach(webView, allowOrigins) { BridgeAccess.originOf(it) in allowOrigins }

        val origins = allowOrigins
        WebViewCompat.addWebMessageListener(webView, CHANNEL, origins) { _, message, sourceOrigin, isMainFrame, _ ->
            val data = message.data ?: return@addWebMessageListener
            if (!isMainFrame || current?.id != id) return@addWebMessageListener
            val parsed = runCatching { JSONObject(data) }.getOrNull() ?: return@addWebMessageListener
            notify(
                    JSONObject()
                            .put("id", id)
                            .put("type", "message")
                            .put("origin", BridgeAccess.originOf(sourceOrigin))
                            .put("message", parsed)
            )
        }
        WebViewCompat.addDocumentStartJavaScript(
                webView,
                channelScript(options.optJSONArray("methods") ?: JSONArray()),
                origins
        )

        val toolbar = options.opt("toolbar") as? JSONObject
        val titleView = toolbar?.let { TextView(activity) }
        val container = buildContainer(webView, toolbar, titleView, id)
        val back =
                object : OnBackPressedCallback(true) {
                    override fun handleOnBackPressed() {
                        if (webView.canGoBack()) webView.goBack() else close(id, "user")
                    }
                }
        val window =
                Window(
                        id = id,
                        allowOrigins = allowOrigins,
                        outsideLinks = options.optString("outsideLinks", "external"),
                        injectScript = options.optString("injectScript"),
                        profile = profile,
                        lightBars = !isNight(),
                        previousLightStatusBar = insetsController().isAppearanceLightStatusBars,
                        webView = webView,
                        container = container,
                        titleView = titleView,
                        back = back
                )
        webView.webViewClient = WindowClient(window)
        current = window
        // Tied to the activity's lifecycle like the app's other back handlers, so it is added back after
        // them when the app returns from the background, and keeps handling back while the window is open.
        activity.onBackPressedDispatcher.addCallback(activity, back)
        setLightStatusBar(window.lightBars)
        root.addView(container, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        webView.loadUrl(url)
    }

    /** Closes window [id] and tells the app's page why. */
    fun close(id: String, reason: String) {
        val window = current?.takeIf { it.id == id } ?: return
        current = null
        window.back.remove()
        setLightStatusBar(window.previousLightStatusBar)
        root.removeView(window.container)
        window.webView.destroy()
        window.profile?.let { name -> root.post { runCatching { ProfileStore.getInstance().deleteProfile(name) } } }
        notify(JSONObject().put("id", id).put("type", "closed").put("reason", reason))
    }

    /** Passes a message from the app's page to window [id]'s page, if that page is from the allowed origins. */
    fun post(id: String, json: String) {
        val window = current?.takeIf { it.id == id } ?: return
        if (!isAllowed(window, window.webView.url)) return
        window.webView.evaluateJavascript(
                "window.__wefterWindowReceive && window.__wefterWindowReceive(${JSONObject.quote(json)})",
                null
        )
    }

    /** Runs [source] in window [id]'s page, if that page is from the allowed origins. */
    fun inject(id: String, source: String) {
        val window = current?.takeIf { it.id == id } ?: return
        if (isAllowed(window, window.webView.url)) window.webView.evaluateJavascript(source, null)
    }

    /** Loads [url], which must be from the allowed origins, in window [id]. */
    fun load(id: String, url: String) {
        val window = current?.takeIf { it.id == id } ?: return
        require(isAllowed(window, url)) { "$url is not from one of allowOrigins" }
        window.webView.loadUrl(url)
    }

    /** Closes the open window when the app's screen closes. */
    fun closeAll() {
        current?.let { close(it.id, "app") }
    }

    private fun isAllowed(window: Window, url: String?): Boolean =
            url != null && BridgeAccess.originOf(Uri.parse(url)) in window.allowOrigins

    private fun isAcceptableOrigin(origin: String): Boolean {
        val uri = Uri.parse(origin)
        return uri.scheme == "https" ||
                (BuildConfig.DEBUG && uri.scheme == "http" && uri.host in setOf("localhost", "127.0.0.1", "10.0.2.2"))
    }

    private fun jsonStrings(array: JSONArray?): List<String> =
            if (array == null) emptyList() else (0 until array.length()).map { array.getString(it) }

    private inner class WindowClient(private val window: Window) : WebViewClient() {
        /**
         * Keeps the window on its allowed origins. Another web page opens outside the app or is blocked, as
         * `outsideLinks` says; links to other apps (`tel:`, `mailto:` …) open in those apps. Frames load.
         */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            val scheme = url.scheme?.lowercase()
            if (!request.isForMainFrame) return false
            if (scheme == "about" || isAllowed(window, url.toString())) return false
            if (scheme == "http" || scheme == "https") {
                if (window.outsideLinks != "block") ExternalLinks.open(activity, url)
                notify(
                        JSONObject()
                                .put("id", window.id)
                                .put("type", "navigation")
                                .put("url", url.toString())
                                .put("handled", if (window.outsideLinks == "block") "block" else "external")
                )
            } else {
                ExternalLinks.open(activity, url)
            }
            return true
        }

        /** Runs the app's `injectScript`, shows the page's title and reports the load. */
        override fun onPageFinished(view: WebView, url: String) {
            if (current !== window) return
            if (isAllowed(window, url) && window.injectScript.isNotBlank()) {
                view.evaluateJavascript(window.injectScript, null)
            }
            window.titleView?.let { title -> if (title.tag != "fixed") title.text = view.title ?: "" }
            notify(
                    JSONObject().put("id", window.id).put("type", "load").put("url", url).put("title", view.title ?: "")
            )
        }

        /** Closes the window when its renderer crashes, instead of the app. */
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            close(window.id, "error")
            return true
        }
    }

    /** The window: a bar (close, title, back and forward) above the web view, clear of the system bars. */
    private fun buildContainer(webView: WebView, toolbar: JSONObject?, titleView: TextView?, id: String): View {
        val night = isNight()
        val background = if (night) Color.rgb(28, 28, 30) else Color.WHITE
        val foreground = if (night) Color.WHITE else Color.rgb(28, 28, 30)

        val container =
                LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(background)
                    isClickable = true
                }
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        if (toolbar != null && titleView != null) {
            val bar =
                    LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                        setBackgroundColor(background)
                    }
            bar.addView(barButton("✕", WefterText.get(activity, "webWindow.close"), foreground) { close(id, "user") })
            titleView.apply {
                val fixedTitle = toolbar.optString("title")
                text = fixedTitle
                if (fixedTitle.isNotEmpty()) tag = "fixed"
                setTextColor(foreground)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                gravity = Gravity.CENTER
            }
            bar.addView(titleView, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (toolbar.optBoolean("navigation")) {
                bar.addView(barButton("‹", WefterText.get(activity, "webWindow.back"), foreground) {
                    if (webView.canGoBack()) webView.goBack()
                })
                bar.addView(barButton("›", WefterText.get(activity, "webWindow.forward"), foreground) {
                    if (webView.canGoForward()) webView.goForward()
                })
            } else {
                bar.addView(View(activity), LinearLayout.LayoutParams(dp(48), dp(48)))
            }
            container.addView(bar, ViewGroup.LayoutParams.MATCH_PARENT, dp(56))
        }
        container.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        return container
    }

    private fun barButton(symbol: String, label: String, color: Int, onClick: () -> Unit): TextView =
            TextView(activity).apply {
                text = symbol
                contentDescription = label
                setTextColor(color)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                gravity = Gravity.CENTER
                isClickable = true
                isFocusable = true
                val ripple = TypedValue()
                activity.theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, ripple, true)
                setBackgroundResource(ripple.resourceId)
                setOnClickListener { onClick() }
                layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
            }

    private fun isNight(): Boolean =
            activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES

    private fun insetsController() = WindowCompat.getInsetsController(activity.window, root)

    /** Dark status bar icons on the window's light bar, light ones on its dark bar. */
    private fun setLightStatusBar(light: Boolean) {
        insetsController().apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    private fun dp(value: Int): Int = (value * activity.resources.displayMetrics.density).toInt()
}
