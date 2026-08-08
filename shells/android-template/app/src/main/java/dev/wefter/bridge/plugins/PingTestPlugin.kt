package dev.wefter.bridge

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

private const val TICK_INTERVAL_MS = 2000L

class PingTestPlugin(context: Context, dispatcher: BridgeDispatcher) : WefterPlugin(context, dispatcher) {
    private val handler = Handler(Looper.getMainLooper())
    private var tickCount = 0

    private val tickRunnable =
            object : Runnable {
                override fun run() {
                    tickCount++
                    emit("tick", JSONObject().apply { put("count", tickCount) })
                    handler.postDelayed(this, TICK_INTERVAL_MS)
                }
            }

    init {
        handler.post(tickRunnable)
    }

    @WefterMethod
    fun ping(payload: JSONObject, callback: (Result<Any>) -> Unit) {
        val result = JSONObject().apply { put("pong", true) }
        resolve(callback, result)
    }
}
