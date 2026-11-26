package dev.wefter.bridge

import java.util.concurrent.ConcurrentHashMap

/**
 * Registry of plugin instances by id, so native code (for example another plugin) can reach a plugin.
 * Thread-safe.
 */
object WefterBridge {
    private val plugins = ConcurrentHashMap<String, WefterPlugin>()

    /** Stores a plugin under its id. Called by the generated registry. */
    internal fun register(pluginId: String, plugin: WefterPlugin) {
        plugins[pluginId] = plugin
    }

    /** The plugin registered under [pluginId], or `null`. */
    fun getPlugin(pluginId: String): WefterPlugin? = plugins[pluginId]
}
