package dev.wefter.bridge

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/** How long the page has to answer a back request before the app does the default. */
private const val PAGE_ANSWER_TIMEOUT_MS = 2000L

/**
 * Back in the app's own pages: the page decides while it listens with `onBack()` from `@wefterjs/core`;
 * otherwise back goes back in the web view's history, then leaves the app.
 *
 * Fullscreen video and web windows add their own handlers while open, which Android asks first. This one
 * is only enabled when it has something to do (the page listens, or there is history to go back to), so
 * Android can show its predictive back-to-home animation at the root.
 */
internal class BackNavigation(
        private val activity: AppCompatActivity,
        private val webView: () -> WebView?,
        /** Sends a `__system:back` event to the app's page. */
        private val notify: (JSONObject) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var listening = false
    private var nextId = 0
    /** The back request the page is answering. */
    private var pendingId: Int? = null
    private var timeout: Runnable? = null
    /** The edge the current back gesture started from (Android 14+). */
    private var gestureEdge: String? = null
    /**
     * Whether the current back request moved, as only a swipe does: Android 14+ starts a back event for the
     * back button and key too, with an edge, but only a swipe reports progress.
     */
    private var gestureMoved = false

    private val callback =
            object : OnBackPressedCallback(false) {
                override fun handleOnBackStarted(backEvent: BackEventCompat) {
                    gestureMoved = false
                    gestureEdge =
                            when (backEvent.swipeEdge) {
                                BackEventCompat.EDGE_LEFT -> "left"
                                BackEventCompat.EDGE_RIGHT -> "right"
                                else -> null
                            }
                }

                override fun handleOnBackProgressed(backEvent: BackEventCompat) {
                    if (backEvent.progress > 0f) gestureMoved = true
                }

                override fun handleOnBackCancelled() {
                    gestureMoved = false
                    gestureEdge = null
                }

                override fun handleOnBackPressed() {
                    val gesture = gestureMoved
                    val edge = if (gesture) gestureEdge else null
                    gestureMoved = false
                    gestureEdge = null
                    onBack(if (gesture) "gesture" else "button", edge)
                }
            }

    /** Registers the handler first, so fullscreen video and web windows opened later come before it. */
    fun attach() {
        activity.onBackPressedDispatcher.addCallback(activity, callback)
        update()
    }

    /** Enables the handler only when it has something to do. Call after the web view's history changes. */
    fun update() {
        callback.isEnabled = listening || webView()?.canGoBack() == true
    }

    /**
     * `__system.setBackListening`: whether the page has `onBack` listeners. A request the page is still
     * answering keeps waiting for that answer.
     */
    fun setListening(value: Boolean) {
        listening = value
        update()
    }

    /** A new page started loading: it registers its own listeners. */
    fun onPageStarted() {
        listening = false
        cancelTimeout()
        pendingId = null
        update()
    }

    /**
     * `__system.backResult`: whether the page handled request [id]. A `pending` answer means a listener is
     * still deciding (a "Quit?" dialog), so the app waits for the final answer instead of timing out.
     */
    fun onResult(id: Int, handled: Boolean, pending: Boolean) {
        if (id != pendingId) return
        cancelTimeout()
        if (pending) return
        finishPending(handled)
    }

    private fun onBack(source: String, edge: String?) {
        if (!listening) {
            defaultBack()
            return
        }
        finishPending(handled = true)
        val id = ++nextId
        pendingId = id
        val event =
                JSONObject()
                        .put("id", id)
                        .put("source", source)
                        .put("canGoBack", webView()?.canGoBack() == true)
        edge?.let { event.put("edge", it) }
        notify(event)
        val runnable = Runnable { if (pendingId == id) finishPending(handled = false) }
        timeout = runnable
        handler.postDelayed(runnable, PAGE_ANSWER_TIMEOUT_MS)
    }

    /** Ends the request the page was answering, doing the default when it wasn't handled. */
    private fun finishPending(handled: Boolean) {
        if (pendingId == null) return
        pendingId = null
        cancelTimeout()
        if (!handled) defaultBack()
    }

    private fun cancelTimeout() {
        timeout?.let { handler.removeCallbacks(it) }
        timeout = null
    }

    /** Goes back in the web view's history, or lets Android leave the app. */
    private fun defaultBack() {
        val view = webView()
        if (view?.canGoBack() == true) {
            view.goBack()
            return
        }
        callback.isEnabled = false
        activity.onBackPressedDispatcher.onBackPressed()
        update()
    }
}
