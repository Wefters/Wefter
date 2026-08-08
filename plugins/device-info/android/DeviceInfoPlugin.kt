package dev.wefter.bridge

import android.content.Context
import org.json.JSONObject

class DeviceInfoPlugin(context: Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher) {
    @WefterMethod
    fun getInfo(payload: JSONObject, callback: (Result<Any>) -> Unit) {
        val result =
                JSONObject().apply {
                    put("platform", "android")
                    put("osVersion", android.os.Build.VERSION.RELEASE)
                }
        resolve(callback, result)
    }
}
