package dev.wefter.bridge

import android.app.Activity
import android.content.pm.PackageManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import org.json.JSONObject

/** A module JavaScript can call through the bridge. Generated dispatch wrappers adapt plugins to it. */
interface NativeModule {
    /** Runs [method] with [payload] and reports the result through [callback], on any thread. */
    fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit)

    /** Gives the module a way to send events to JavaScript. Optional. */
    fun attachEmitter(emit: (String, JSONObject) -> Unit) {}
}

/**
 * Receives calls from JavaScript (exposed to the page as `window.AndroidBridge`), routes them to the
 * registered modules and sends results, errors and events back to the web view. It also tracks runtime
 * permission requests made by plugins.
 */
class BridgeDispatcher(private val webView: WebView) {
    private val modules = mutableMapOf<String, NativeModule>()
    private val hookSubscribers = mutableMapOf<String, MutableList<() -> Unit>>()

    private val pendingPermissionRequests = mutableMapOf<Int, (Boolean) -> Unit>()
    private var nextPermissionRequestCode = 1000

    /** Registers a module under the name JavaScript uses. */
    fun register(name: String, module: NativeModule) {
        modules[name] = module
        module.attachEmitter { hookName, data -> emit(hookName, data) }
    }

    /** Runs [callback] whenever a lifecycle hook (such as `appReady`) fires. */
    fun subscribeHook(hookName: String, callback: () -> Unit) {
        hookSubscribers.getOrPut(hookName) { mutableListOf() }.add(callback)
    }

    /** Fires a lifecycle hook. */
    fun dispatchHook(hookName: String) {
        hookSubscribers[hookName]?.forEach { it() }
    }

    /** Requests [permission] from the user; [onResult] receives whether it was granted. */
    fun requestPermission(
            activity: Activity,
            permission: String,
            onResult: (granted: Boolean) -> Unit
    ) {
        val requestCode = nextPermissionRequestCode++
        pendingPermissionRequests[requestCode] = onResult
        ActivityCompat.requestPermissions(activity, arrayOf(permission), requestCode)
    }

    /** Delivers a permission result from the activity to the plugin that asked for it. */
    fun handlePermissionResult(requestCode: Int, grantResults: IntArray) {
        val callback = pendingPermissionRequests.remove(requestCode) ?: return
        val granted =
                grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        callback(granted)
    }

    /**
     * Handles a call from JavaScript. Unknown plugins and invalid payloads are rejected; errors returned or
     * thrown by the module are sent back with their code and, in debug builds, the native stack trace.
     */
    @JavascriptInterface
    fun invoke(callId: String, plugin: String, method: String, payloadJson: String) {
        val module = modules[plugin]
        if (module == null) {
            webView.post { sendReject(callId, "UNKNOWN_PLUGIN", "No such plugin: $plugin") }
            return
        }
        val payload =
                try {
                    JSONObject(payloadJson)
                } catch (e: Exception) {
                    webView.post { sendReject(callId, "INVALID_PAYLOAD", "Invalid payload: ${e.message}") }
                    return
                }
        try {
            module.invoke(method, payload) { result ->
                webView.post {
                    result.fold(
                            onSuccess = { sendResolve(callId, it) },
                            onFailure = {
                                val code = if (it is WefterError) it.code else "UNKNOWN"
                                sendReject(callId, code, it.message ?: "Unknown error", it.stackTraceToString())
                            }
                    )
                }
            }
        } catch (e: Exception) {
            webView.post {
                sendReject(
                        callId,
                        "PLUGIN_THREW",
                        "Plugin threw: ${e.message ?: e.toString()}",
                        e.stackTraceToString()
                )
            }
        }
    }

    /** Name of the build flavor (environment), reported to `getPlatformInfo()`. */
    @JavascriptInterface fun getEnvironment(): String = BuildConfig.FLAVOR

    /** Sends an event to JavaScript listeners. */
    fun emit(hookName: String, data: JSONObject) {
        webView.post {
            val js = "window.__wefterNative.emit('$hookName', ${JSONObject.quote(data.toString())})"
            webView.evaluateJavascript(js, null)
        }
    }

    /** Resolves a pending JavaScript call. Must run on the main thread. */
    private fun sendResolve(callId: String, result: Any) {
        val json =
                if (result is JSONObject) result.toString() else JSONObject.quote(result.toString())
        webView.evaluateJavascript(
                "window.__wefterNative.resolve('$callId', ${JSONObject.quote(json)})",
                null
        )
    }

    /** Rejects a pending JavaScript call. Must run on the main thread. */
    private fun sendReject(callId: String, code: String, message: String, nativeStack: String? = null) {
        val errorBody = JSONObject().put("code", code).put("message", message)
        if (BuildConfig.DEBUG && nativeStack != null) {
            errorBody.put("nativeStack", nativeStack)
        }
        webView.evaluateJavascript(
                "window.__wefterNative.reject('$callId', ${JSONObject.quote(errorBody.toString())})",
                null
        )
    }
}
