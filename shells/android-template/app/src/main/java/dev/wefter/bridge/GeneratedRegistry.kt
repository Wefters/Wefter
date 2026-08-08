
package dev.wefter.bridge

import android.content.Context
import org.json.JSONObject

class DeviceInfoPluginDispatch(private val plugin: DeviceInfoPlugin) : NativeModule {
    override fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit) {
        when (method) {
            "getInfo" -> plugin.getInfo(payload, callback)
            else -> callback(Result.failure(WefterError("UNKNOWN_METHOD", "No such method: $method")))
        }
    }
}

class PingTestPluginDispatch(private val plugin: PingTestPlugin) : NativeModule {
    override fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit) {
        when (method) {
            "ping" -> plugin.ping(payload, callback)
            else -> callback(Result.failure(WefterError("UNKNOWN_METHOD", "No such method: $method")))
        }
    }
}

object GeneratedRegistry {
    fun registerAll(context: Context, dispatcher: BridgeDispatcher) {
        val deviceInfoPlugin = DeviceInfoPlugin(context, dispatcher)
        dispatcher.register("device-info", DeviceInfoPluginDispatch(deviceInfoPlugin))
        val pingTestPlugin = PingTestPlugin(context, dispatcher)
        dispatcher.register("ping-test", PingTestPluginDispatch(pingTestPlugin))
    }
}
