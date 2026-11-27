package dev.wefter.bridge

import android.net.Uri
import org.json.JSONObject

/**
 * Which pages may call which plugins through the bridge.
 *
 * The app's own pages (the bundled app, or the dev server in debug builds) may call everything, in any
 * frame. Another site may only call the plugin methods `frames.plugins` in `wefter.config.json` grants
 * it, such as `biometric.authenticate` or `haptics.*`; every other site is refused.
 */
internal class BridgeAccess(
        private val ownOrigins: Set<String>,
        private val grants: Map<String, List<String>>
) {
    /** Origins that get the bridge at all, as the web view's origin rules write them. */
    val bridgeOrigins: Set<String> = ownOrigins + grants.keys

    /** Whether [origin] is one of the app's own pages. */
    fun isOwn(origin: String): Boolean = origin in ownOrigins

    /** Whether [origin] may call [method] of [plugin]. The built-in `__system` module is the app's own. */
    fun allows(origin: String, plugin: String, method: String): Boolean {
        if (isOwn(origin)) return true
        if (plugin.startsWith("__")) return false
        return grants[origin].orEmpty().any { it == "$plugin.$method" || it == "$plugin.*" }
    }

    companion object {
        /** `scheme://host[:port]` of [uri], the way origin rules and `frames` write origins. */
        fun originOf(uri: Uri): String {
            val port = if (uri.port != -1) ":${uri.port}" else ""
            return "${uri.scheme}://${uri.host}$port"
        }

        /** Reads `frames.plugins` as the CLI writes it into `BuildConfig.FRAME_PLUGIN_GRANTS` (JSON). */
        fun parseGrants(json: String): Map<String, List<String>> {
            if (json.isBlank()) return emptyMap()
            val grants = mutableMapOf<String, List<String>>()
            val root = JSONObject(json)
            for (origin in root.keys()) {
                val methods = root.optJSONArray(origin) ?: continue
                grants[origin] = (0 until methods.length()).map { methods.getString(it) }
            }
            return grants
        }
    }
}
