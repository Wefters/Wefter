package dev.wefter.bridge

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
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
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.ColorUtils
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

private const val ASSETS_ORIGIN = "appassets.androidplatform.net"
private const val BUNDLED_URL = "https://$ASSETS_ORIGIN/assets/www/index.html"
private const val SPLASH_URL = "https://$ASSETS_ORIGIN/assets/www/splash.html"
private const val BLANK_URL = "about:blank"
private const val MAX_RENDER_PROCESS_RETRIES = 3

private const val SPLASH_FALLBACK_TIMEOUT_MS = 15000L

private const val CONTENT_SECURITY_POLICY =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:;"

class MainActivity : AppCompatActivity() {
    private lateinit var root: FrameLayout
    private lateinit var assetLoader: WebViewAssetLoader
    private var devServerHost: String? = null

    private lateinit var webView: WebView
    private lateinit var dispatcher: BridgeDispatcher
    private var splashOverlay: WebView? = null
    private val splashStartTime = System.currentTimeMillis()
    private var splashDismissed = false

    private var usingDevServer = false
    private var renderProcessCrashCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        root = FrameLayout(this)
        setContentView(root)

        val backgroundLuminance = ColorUtils.calculateLuminance(getColor(R.color.splashBackground))
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = backgroundLuminance > 0.5
            isAppearanceLightNavigationBars = backgroundLuminance > 0.5
        }

        assetLoader =
                WebViewAssetLoader.Builder()
                        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
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
    }

    override fun onRequestPermissionsResult(
            requestCode: Int,
            permissions: Array<out String>,
            grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        dispatcher.handlePermissionResult(requestCode, grantResults)
    }

    private fun setupSplash() {
        val splash =
                WebView(this).also {
                    it.settings.javaScriptEnabled = true
                    it.webViewClient =
                            object : WebViewClient() {
                                override fun shouldInterceptRequest(
                                        view: WebView,
                                        request: WebResourceRequest
                                ) = interceptWithCsp(request)
                            }
                    it.loadUrl(SPLASH_URL)

                    root.addView(
                            it,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                    )
                }
        splashOverlay = splash

        dispatcher.subscribeHook("appReady") { dismissSplash() }
        root.postDelayed({ dismissSplash() }, SPLASH_FALLBACK_TIMEOUT_MS)
    }

    private fun interceptWithCsp(request: WebResourceRequest): WebResourceResponse? {
        val response = assetLoader.shouldInterceptRequest(request.url) ?: return null
        val headers =
                (response.responseHeaders
                        ?: emptyMap()) + mapOf("Content-Security-Policy" to CONTENT_SECURITY_POLICY)
        response.responseHeaders = headers
        return response
    }

    private fun createPrimaryWebView(): WebView {
        val newWebView = WebView(this)
        newWebView.settings.javaScriptEnabled = true

        newWebView.webViewClient =
                object : WebViewClient() {
                    override fun shouldInterceptRequest(
                            view: WebView,
                            request: WebResourceRequest
                    ) = interceptWithCsp(request)

                    override fun onPageFinished(view: WebView, url: String) {

                        dispatcher.dispatchHook("appReady")
                    }

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
                            usingDevServer = false
                            Toast.makeText(
                                            this@MainActivity,
                                            "Dev server unreachable",
                                            Toast.LENGTH_LONG
                                    )
                                    .show()
                            view.loadUrl(BLANK_URL)
                        }
                    }

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
                            "appReady" -> {
                                dispatcher.dispatchHook("appReady")
                                callback(Result.success(JSONObject()))
                            }
                            else -> callback(Result.failure(Exception("Unknown method: $method")))
                        }
                    }
                }
        )
        newWebView.addJavascriptInterface(dispatcher, "AndroidBridge")

        return newWebView
    }

    private fun loadInitialContent(preferDevServer: Boolean = true) {
        val devServerUrl = BuildConfig.DEV_SERVER_URL
        val isDevServerBuild = BuildConfig.DEBUG && devServerUrl.isNotEmpty()
        when {
            preferDevServer && isDevServerBuild -> {
                usingDevServer = true
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

    private fun showRendererDeadFallback() {
        val message =
                TextView(this).also {
                    it.text = "This app isn't working right now.\nPlease close and reopen it."
                    it.gravity = Gravity.CENTER
                    it.textSize = 16f
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

    private fun dismissSplash() {
        val overlay = splashOverlay ?: return
        if (splashDismissed) return
        splashDismissed = true
        val elapsed = System.currentTimeMillis() - splashStartTime
        val remaining = (BuildConfig.SPLASH_MIN_DURATION_MS - elapsed).coerceAtLeast(0)
        overlay.postDelayed(
                {
                    overlay.animate()
                            .alpha(0f)
                            .setDuration(BuildConfig.SPLASH_FADE_OUT_MS)
                            .withEndAction {
                                overlay.visibility = View.GONE
                                splashOverlay = null
                            }
                            .start()
                },
                remaining
        )
    }
}
