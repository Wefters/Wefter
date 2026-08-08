package dev.wefter.bridge

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

interface NativeModule {
    fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit)

    fun attachEmitter(emit: (String, JSONObject) -> Unit) {}
}

class BridgeDispatcher(private val webView: WebView) {
    private val modules = mutableMapOf<String, NativeModule>()
    private val hookSubscribers = mutableMapOf<String, MutableList<() -> Unit>>()

    fun register(name: String, module: NativeModule) {
        modules[name] = module
        module.attachEmitter { hookName, data -> emit(hookName, data) }
    }

    fun subscribeHook(hookName: String, callback: () -> Unit) {
        hookSubscribers.getOrPut(hookName) { mutableListOf() }.add(callback)
    }

    fun dispatchHook(hookName: String) {
        hookSubscribers[hookName]?.forEach { it() }
    }

    @JavascriptInterface
    fun invoke(callId: String, plugin: String, method: String, payloadJson: String) {
        val module = modules[plugin]
        if (module == null) {
            sendReject(callId, "UNKNOWN_PLUGIN", "No such plugin: $plugin")
            return
        }
        val payload =
                try {
                    JSONObject(payloadJson)
                } catch (e: Exception) {
                    sendReject(callId, "INVALID_PAYLOAD", "Invalid payload: ${e.message}")
                    return
                }
        try {
            module.invoke(method, payload) { result ->
                webView.post {
                    result.fold(
                            onSuccess = { sendResolve(callId, it) },
                            onFailure = {
                                val code = if (it is WefterError) it.code else "UNKNOWN"
                                sendReject(callId, code, it.message ?: "Unknown error")
                            }
                    )
                }
            }
        } catch (e: Exception) {
            sendReject(callId, "PLUGIN_THREW", "Plugin threw: ${e.message ?: e.toString()}")
        }
    }

    @JavascriptInterface fun getEnvironment(): String = BuildConfig.FLAVOR

    fun emit(hookName: String, data: JSONObject) {
        webView.post {
            val js = "window.__wefterNative.emit('$hookName', ${JSONObject.quote(data.toString())})"
            webView.evaluateJavascript(js, null)
        }
    }

    private fun sendResolve(callId: String, result: Any) {
        val json =
                if (result is JSONObject) result.toString() else JSONObject.quote(result.toString())
        webView.evaluateJavascript(
                "window.__wefterNative.resolve('$callId', ${JSONObject.quote(json)})",
                null
        )
    }

    private fun sendReject(callId: String, code: String, message: String) {
        val errorJson = JSONObject().put("code", code).put("message", message).toString()
        webView.evaluateJavascript(
                "window.__wefterNative.reject('$callId', ${JSONObject.quote(errorJson)})",
                null
        )
    }
}
