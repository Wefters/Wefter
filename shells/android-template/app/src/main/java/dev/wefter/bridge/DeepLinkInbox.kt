package dev.wefter.bridge

import org.json.JSONArray
import org.json.JSONObject

/**
 * Holds the URLs the app is opened with until the web app takes them through `__system.takeDeepLinks`.
 *
 * `MainActivity` puts links in as they arrive, which can be before the web view or its page exist. The inbox
 * lives for the whole process, so links survive a page reload or a renderer crash. Its methods are
 * synchronised because JavaScript calls reach it on the bridge thread.
 */
object DeepLinkInbox {
    /** Links kept while the web app is not taking them; older ones are dropped beyond this. */
    private const val MAX_PENDING_LINKS = 20

    /** The URL that opened the current activity, or `null` when it was opened normally. */
    @get:Synchronized
    var launchUrl: String? = null
        private set

    private val pending = ArrayDeque<JSONObject>()
    private var onReceive: (() -> Unit)? = null

    /** Starts a new activity session: records its launch URL (if any) and drops links left from an earlier one. */
    fun launch(url: String?) {
        val listener =
                synchronized(this) {
                    launchUrl = url
                    pending.clear()
                    if (url == null) return
                    enqueue(url, isLaunch = true)
                }
        listener?.invoke()
    }

    /** Adds a link that reached the app while it was running. */
    fun receive(url: String) {
        val listener = synchronized(this) { enqueue(url, isLaunch = false) }
        listener?.invoke()
    }

    /** Returns the waiting links, oldest first, and empties the inbox. */
    @Synchronized
    fun take(): JSONArray {
        val links = JSONArray()
        pending.forEach { links.put(it) }
        pending.clear()
        return links
    }

    /** Sets the callback run whenever a link arrives (the web view then fetches it with [take]). */
    @Synchronized
    fun setListener(listener: (() -> Unit)?) {
        onReceive = listener
    }

    /** Stores a link and returns the listener to tell, which the caller runs outside the lock. */
    private fun enqueue(url: String, isLaunch: Boolean): (() -> Unit)? {
        pending.addLast(JSONObject().put("url", url).put("isLaunch", isLaunch))
        while (pending.size > MAX_PENDING_LINKS) pending.removeFirst()
        return onReceive
    }
}
