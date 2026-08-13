package dev.wefter.bridge

import java.util.concurrent.ConcurrentHashMap

/**
 * Framework-owned registry of live plugin instances, keyed by plugin name. Lets a native component
 * that isn't the dispatcher's own Activity, a launched Activity, a Service, a BroadcastReceiver —
 * reach back into a plugin to call `emit()`/dispatch a hook, without every plugin author
 * hand-rolling their own static accessor.
 */
object WefterBridge {
    private val plugins = ConcurrentHashMap<String, WefterPlugin>()

    internal fun register(pluginId: String, plugin: WefterPlugin) {
        plugins[pluginId] = plugin
    }

    fun getPlugin(pluginId: String): WefterPlugin? = plugins[pluginId]
}
