package dev.wefter.bridge

import org.json.JSONArray
import org.json.JSONObject

/**
 * Holds plugin events until the web app takes them through `__system.takeEvents`, for events that can
 * happen before the page listens: a notification tap that launched the app, for example. Plugins add them
 * with `emit(name, data, hold = true)`.
 *
 * Like [DeepLinkInbox] it lives for the whole process, so events survive a page reload or a renderer
 * crash; they are lost if the process ends. `@wefterjs/core` takes the events of a name when the first
 * listener for it registers, and again whenever the inbox says more arrived. Its methods are synchronised
 * because plugins call it from any thread.
 */
object EventInbox {
    /** Events of one name kept while nobody takes them; older ones are dropped beyond this. */
    private const val MAX_PER_NAME = 20

    private val held = LinkedHashMap<String, ArrayDeque<JSONObject>>()
    private var onHold: ((String) -> Unit)? = null

    /** Keeps [data] under [name] and tells the listener. */
    fun hold(name: String, data: JSONObject) {
        val listener =
                synchronized(this) {
                    val events = held.getOrPut(name) { ArrayDeque() }
                    events.addLast(data)
                    while (events.size > MAX_PER_NAME) events.removeFirst()
                    onHold
                }
        listener?.invoke(name)
    }

    /** Returns the events held under [name], oldest first, and forgets them. */
    @Synchronized
    fun take(name: String): JSONArray {
        val events = JSONArray()
        held.remove(name)?.forEach { events.put(it) }
        return events
    }

    /** Sets the callback run with the name of each event that arrives (the page then takes it). */
    @Synchronized
    fun setListener(listener: ((String) -> Unit)?) {
        onHold = listener
    }
}
