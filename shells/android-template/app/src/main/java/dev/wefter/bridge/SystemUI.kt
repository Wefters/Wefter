package dev.wefter.bridge

import android.graphics.Rect
import android.os.Build
import android.view.View
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject

/** CSS the app's pages get while `gestures.longPress` is off. Inputs stay selectable. */
private const val NO_LONG_PRESS_CSS =
        "html{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;" +
                "-webkit-tap-highlight-color:transparent}img,a{-webkit-user-drag:none}" +
                "input,textarea,select,[contenteditable],[contenteditable] *{-webkit-user-select:text;user-select:text}"

/** CSS the app's pages get while `gestures.zoom` is off: no pinch or double-tap zoom. */
private const val NO_ZOOM_CSS = "html{touch-action:pan-x pan-y}"

/** Width of the strips along the side edges that `edgeProtection: true` protects. */
private const val EDGE_STRIP_DP = 48

/**
 * Applies [state] to the page it runs in: the safe area as `--wefter-safe-area-*` CSS variables and the
 * CSS for gestures that are off. Runs at document start in every page and again whenever a setting changes;
 * frames inside the page are left alone.
 */
private fun uiScript(state: JSONObject): String =
        """
(function (s) {
  if (window !== window.top) return;
  var root = document.documentElement;
  if (!root) return;
  for (var key in s.safeArea) root.style.setProperty("--wefter-safe-area-" + key, s.safeArea[key] + "px");
  var css = (s.longPress ? "" : ${JSONObject.quote(NO_LONG_PRESS_CSS)}) + (s.zoom ? "" : ${JSONObject.quote(NO_ZOOM_CSS)});
  var style = document.getElementById("__wefter-ui");
  if (!css) { if (style) style.remove(); return; }
  if (!style) { style = document.createElement("style"); style.id = "__wefter-ui"; (document.head || root).appendChild(style); }
  style.textContent = css;
})($state);
"""

/**
 * The system bars, gestures and safe area of the app's screen: `systemBars`, `gestures`, `audio` and
 * `text` in `wefter.config.json`, changed at runtime by `setSystemBars()` and `setGestures()` from
 * `@wefterjs/core`.
 *
 * Bars and icon colours are re-applied whenever the app returns, since Android shows hidden bars again
 * after the app leaves the screen. Fullscreen video and web windows override them while open.
 */
internal class SystemUI(
        private val activity: AppCompatActivity,
        private val root: View,
        /** `launchBackground`, which `icons: "auto"` suits. */
        private val launchBackground: Int,
        /** Sends a `__system:safeArea` event to the app's page. */
        private val notifySafeArea: (JSONObject) -> Unit,
) {
    private val config = runCatching { JSONObject(BuildConfig.SYSTEM_UI) }.getOrElse { JSONObject() }

    var barsHidden = config.optBoolean("barsHidden", false)
        private set
    var icons = config.optString("icons", "auto")
        private set
    private var zoom = config.optBoolean("zoom", true)
    private var longPress = config.optBoolean("longPress", true)
    private var overscroll = config.optBoolean("overscroll", true)
    /** `true`, `false`, or a [JSONArray] of areas in CSS pixels. */
    private var edgeProtection: Any = config.opt("edgeProtection").let { if (it is JSONArray) it else it == true }
    private var swipeBack: Any = config.opt("swipeBack").let { if (it == false) false else (it as? String ?: "history") }

    /** `audio.autoplay`: media may play without a tap. Only read when a web view is created. */
    private val autoplay = config.optBoolean("autoplay", false)
    /** `text.followSystemSize`: the page's text follows Android's font size setting. */
    private val followSystemTextSize = config.optBoolean("followSystemTextSize", true)

    /** Fullscreen video is showing: the bars stay hidden whatever the app asked for. */
    private var fullscreen = false
    /** A web window is open with its own icon colour (`true` for dark icons). */
    private var windowLightIcons: Boolean? = null

    private var safeArea = JSONObject().put("top", 0).put("right", 0).put("bottom", 0).put("left", 0)
    private var webView: WebView? = null
    private var scriptHandler: ScriptHandler? = null
    private var allowedOrigins: Set<String> = emptySet()

    /**
     * Starts following the screen's insets. Returns them unchanged, so web windows below still get them.
     */
    fun attach() {
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            updateSafeArea(insets)
            insets
        }
        applyBars()
    }

    /**
     * Applies the settings to the app's web view, created at start or after a renderer crash, whose pages
     * from [origins] get the safe area and gesture CSS.
     */
    fun configure(webView: WebView, origins: Set<String>) {
        this.webView = webView
        allowedOrigins = origins
        scriptHandler = null
        webView.settings.mediaPlaybackRequiresUserGesture = !autoplay
        if (!followSystemTextSize) webView.settings.textZoom = 100
        webView.setOnLongClickListener { view ->
            !longPress && (view as WebView).hitTestResult.type != WebView.HitTestResult.EDIT_TEXT_TYPE
        }
        webView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> applyEdgeProtection() }
        applyGestures()
        updateScript()
    }

    /** Re-applies the bars, which Android shows again after the app leaves the screen. */
    fun onResume() = applyBars()

    /** Fullscreen video started or ended. */
    fun setFullscreen(active: Boolean) {
        fullscreen = active
        applyBars()
    }

    /** A web window opened with dark ([light] `true`) or light icons, or closed (`null`). */
    fun setWindowIcons(light: Boolean?) {
        windowLightIcons = light
        applyBars()
    }

    /** Runs the safe area and gesture CSS in the page that just started showing (single-page apps keep it). */
    fun onPageCommitted(view: WebView) {
        view.evaluateJavascript(uiScript(scriptState()), null)
    }

    /** `__system.setSystemBars`: changes the given settings and returns them all. */
    fun setBars(payload: JSONObject): JSONObject {
        if (payload.has("hidden")) barsHidden = payload.optBoolean("hidden")
        payload.optString("icons").takeIf { it in setOf("auto", "dark", "light") }?.let { icons = it }
        applyBars()
        return barsState()
    }

    fun barsState(): JSONObject =
            JSONObject()
                    .put("hidden", barsHidden)
                    .put("icons", icons)
                    .put("supported", JSONObject().put("hidden", true).put("icons", true))

    /** `__system.setGestures`: changes the given settings and returns them all. */
    fun setGestures(payload: JSONObject): JSONObject {
        if (payload.has("zoom")) zoom = payload.optBoolean("zoom")
        if (payload.has("longPress")) longPress = payload.optBoolean("longPress")
        if (payload.has("overscroll")) overscroll = payload.optBoolean("overscroll")
        if (payload.has("swipeBack")) {
            swipeBack = payload.opt("swipeBack").let { if (it == false) false else (it as? String ?: "history") }
        }
        if (payload.has("edgeProtection")) {
            edgeProtection = payload.opt("edgeProtection").let { if (it is JSONArray) it else it == true }
        }
        applyGestures()
        updateScript()
        return gesturesState()
    }

    fun gesturesState(): JSONObject =
            JSONObject()
                    .put("swipeBack", swipeBack)
                    .put("zoom", zoom)
                    .put("longPress", longPress)
                    .put("overscroll", overscroll)
                    .put("edgeProtection", edgeProtection)
                    .put(
                            "supported",
                            JSONObject()
                                    .put("swipeBack", false)
                                    .put("zoom", true)
                                    .put("longPress", true)
                                    .put("overscroll", true)
                                    .put("edgeProtection", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    )

    fun safeAreaState(): JSONObject = JSONObject(safeArea.toString())

    private fun applyBars() {
        val controller = WindowCompat.getInsetsController(activity.window, root)
        val lightIcons =
                windowLightIcons
                        ?: when (icons) {
                            "dark" -> true
                            "light" -> false
                            else -> ColorUtils.calculateLuminance(launchBackground) > 0.5
                        }
        controller.isAppearanceLightStatusBars = lightIcons
        controller.isAppearanceLightNavigationBars = lightIcons
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (barsHidden || fullscreen) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun applyGestures() {
        val view = webView ?: return
        view.settings.setSupportZoom(zoom)
        view.settings.builtInZoomControls = zoom
        view.settings.displayZoomControls = false
        view.overScrollMode = if (overscroll) View.OVER_SCROLL_IF_CONTENT_SCROLLS else View.OVER_SCROLL_NEVER
        view.isHapticFeedbackEnabled = longPress
        applyEdgeProtection()
    }

    /** Asks Android to keep its back gesture off the protected areas (Android 10+). */
    private fun applyEdgeProtection() {
        val view = webView ?: return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val density = activity.resources.displayMetrics.density
        val rects =
                when (val protection = edgeProtection) {
                    true -> {
                        val strip = (EDGE_STRIP_DP * density).toInt()
                        listOf(Rect(0, 0, strip, view.height), Rect(view.width - strip, 0, view.width, view.height))
                    }
                    is JSONArray ->
                            (0 until protection.length()).mapNotNull { index ->
                                protection.optJSONObject(index)?.let { area ->
                                    val x = area.optDouble("x", 0.0) * density
                                    val y = area.optDouble("y", 0.0) * density
                                    Rect(
                                            x.toInt(),
                                            y.toInt(),
                                            (x + area.optDouble("width", 0.0) * density).toInt(),
                                            (y + area.optDouble("height", 0.0) * density).toInt()
                                    )
                                }
                            }
                    else -> emptyList()
                }
        ViewCompat.setSystemGestureExclusionRects(view, rects)
    }

    /** Reads the safe area from [insets], in CSS pixels, and tells the page when it changed. */
    private fun updateSafeArea(insets: WindowInsetsCompat) {
        val area = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val density = activity.resources.displayMetrics.density
        fun css(px: Int): Double = Math.round(px / density * 100) / 100.0
        val next =
                JSONObject()
                        .put("top", css(area.top))
                        .put("right", css(area.right))
                        .put("bottom", css(area.bottom))
                        .put("left", css(area.left))
        if (next.toString() == safeArea.toString()) return
        safeArea = next
        updateScript()
        notifySafeArea(safeAreaState())
    }

    private fun scriptState(): JSONObject =
            JSONObject().put("safeArea", safeArea).put("longPress", longPress).put("zoom", zoom)

    /**
     * Replaces the document start script with one carrying the current settings, so the next page starts
     * with them, and applies them to the current page.
     */
    private fun updateScript() {
        val view = webView ?: return
        val script = uiScript(scriptState())
        scriptHandler?.remove()
        scriptHandler = WebViewCompat.addDocumentStartJavaScript(view, script, allowedOrigins)
        view.evaluateJavascript(script, null)
    }
}
