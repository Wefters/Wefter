package dev.wefter.bridge

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import java.util.concurrent.Executors
import org.json.JSONObject

/** A module JavaScript can call through the bridge. Generated dispatch wrappers adapt plugins to it. */
interface NativeModule {
    /** Runs [method] with [payload] and reports the result through [callback], on any thread. */
    fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit)

    /** Gives the module a way to send events to JavaScript. Optional. */
    fun attachEmitter(emit: (String, JSONObject) -> Unit) {}
}

/** Name of the message channel pages call the bridge through, `window.WefterBridge`. */
private const val CHANNEL = "WefterBridge"

/**
 * Runs in the pages that may use the bridge. Defines `window.AndroidBridge`, which `@wefterjs/core` calls,
 * on top of the [CHANNEL] message channel, and hands results back to `window.__wefterNative`. Pages from
 * other origins get neither, since the web view only adds both to the origins [BridgeAccess] lists.
 */
private fun bridgeScript(environment: String): String =
        """
(function () {
  var channel = window.$CHANNEL;
  if (!channel || window.__wefterAndroidBridge) return;
  window.__wefterAndroidBridge = true;
  var environment = ${JSONObject.quote(environment)};
  window.__WEFTER_ANDROID_ENV__ = environment;
  channel.addEventListener('message', function (event) {
    var native = window.__wefterNative;
    if (!native) return;
    var message = JSON.parse(event.data);
    if (message.type === 'resolve') native.resolve(message.callId, message.data);
    else if (message.type === 'reject') native.reject(message.callId, message.data);
  });
  window.AndroidBridge = {
    invoke: function (callId, plugin, method, payloadJson) {
      channel.postMessage(JSON.stringify({ callId: callId, plugin: plugin, method: method, payload: payloadJson }));
    },
    getEnvironment: function () { return environment; }
  };
})();
"""

/**
 * Receives calls from JavaScript, routes them to the registered modules and sends results, errors and
 * events back to the web view.
 *
 * Calls arrive over a web message channel that the web view only offers to the origins in [access], and
 * each call is checked again against [access] with the origin the web view reports, so a frame from
 * another site cannot reach plugins it was not granted. Modules run on one background thread, in the
 * order the calls arrive, as `@JavascriptInterface` calls did.
 *
 * The dispatcher lives as long as the activity; [attach] points it at a new web view after the old one's
 * renderer crashed, so plugins are created once.
 */
class BridgeDispatcher
internal constructor(
        private val access: BridgeAccess,
        private val environment: String,
        /** Runs on the main thread; replaced in tests. */
        private val onMain: (() -> Unit) -> Unit = mainThreadRunner(),
        /** Runs plugin calls in order on one background thread; replaced in tests. */
        private val inBackground: (() -> Unit) -> Unit = bridgeThreadRunner()
) {
    private val modules = mutableMapOf<String, NativeModule>()
    private val hookSubscribers = mutableMapOf<String, MutableList<() -> Unit>>()
    private var webView: WebView? = null

    /** Asks for Android permissions; set by `MainActivity` before plugins are created. */
    internal lateinit var permissions: RuntimePermissions

    /** Registers a module under the name JavaScript uses. */
    fun register(name: String, module: NativeModule) {
        modules[name] = module
        module.attachEmitter { hookName, data -> emit(hookName, data) }
    }

    /** Connects the bridge to [webView]: its pages from the allowed origins get `window.AndroidBridge`. */
    fun attach(webView: WebView) {
        this.webView = webView
        WebViewCompat.addWebMessageListener(webView, CHANNEL, access.bridgeOrigins) {
                _, message, sourceOrigin, _, replyProxy ->
            message.data?.let { json ->
                handleCall(json, BridgeAccess.originOf(sourceOrigin)) { reply -> replyProxy.postMessage(reply) }
            }
        }
        WebViewCompat.addDocumentStartJavaScript(webView, bridgeScript(environment), access.bridgeOrigins)
    }

    /** Runs [callback] whenever a lifecycle hook (such as `appReady`) fires. */
    fun subscribeHook(hookName: String, callback: () -> Unit) {
        hookSubscribers.getOrPut(hookName) { mutableListOf() }.add(callback)
    }

    /** Fires a lifecycle hook. */
    fun dispatchHook(hookName: String) {
        hookSubscribers[hookName]?.forEach { it() }
    }

    /**
     * Requests [permission] from the user; [onResult] receives whether it was granted.
     *
     * Kept for plugins written before [WefterPlugin.requestPermissions]; [activity] is not needed any more.
     */
    @Deprecated("Use WefterPlugin.requestPermissions", ReplaceWith("requestPermissions(listOf(permission))"))
    fun requestPermission(
            @Suppress("UNUSED_PARAMETER") activity: Activity,
            permission: String,
            onResult: (granted: Boolean) -> Unit
    ) {
        onMain {
            permissions.request(listOf(permission)) { states ->
                onResult(states[permission] == PermissionState.GRANTED)
            }
        }
    }

    /**
     * Handles a call from a page. Calls from origins not allowed to use the plugin, unknown plugins and
     * invalid messages are rejected; errors returned or thrown by the module are sent back with their code
     * and, in debug builds, the native stack trace.
     */
    internal fun handleCall(json: String, origin: String, reply: (String) -> Unit) {
        val call =
                try {
                    JSONObject(json)
                } catch (e: Exception) {
                    return
                }
        val callId = call.optString("callId")
        val plugin = call.optString("plugin")
        val method = call.optString("method")
        if (!access.allows(origin, plugin, method)) {
            sendReject(reply, callId, "FORBIDDEN_ORIGIN", "$origin may not call $plugin.$method")
            return
        }
        val module = modules[plugin]
        if (module == null) {
            sendReject(reply, callId, "UNKNOWN_PLUGIN", "No such plugin: $plugin")
            return
        }
        val payload =
                try {
                    JSONObject(call.optString("payload").ifEmpty { "{}" })
                } catch (e: Exception) {
                    sendReject(reply, callId, "INVALID_PAYLOAD", "Invalid payload: ${e.message}")
                    return
                }
        inBackground {
            try {
                module.invoke(method, payload) { result ->
                    result.fold(
                            onSuccess = { sendResolve(reply, callId, it) },
                            onFailure = {
                                val code = if (it is WefterError) it.code else "UNKNOWN"
                                sendReject(reply, callId, code, it.message ?: "Unknown error", it.stackTraceToString())
                            }
                    )
                }
            } catch (e: Exception) {
                sendReject(
                        reply,
                        callId,
                        "PLUGIN_THREW",
                        "Plugin threw: ${e.message ?: e.toString()}",
                        e.stackTraceToString()
                )
            }
        }
    }

    /**
     * Sends an event to JavaScript listeners in the app's page. Plugins can emit as soon as they start
     * (battery and network callbacks fire on registration), before `@wefterjs/core` has set up
     * `window.__wefterNative`; no one can be listening yet, so such an event is dropped instead of throwing
     * in the page. Use [WefterPlugin.emit] with `hold = true` for events that must wait for a listener.
     */
    fun emit(hookName: String, data: JSONObject) {
        onMain {
            val js =
                    "window.__wefterNative && window.__wefterNative.emit(${JSONObject.quote(hookName)}, " +
                            "${JSONObject.quote(data.toString())})"
            webView?.evaluateJavascript(js, null)
        }
    }

    /** Resolves a pending call in the frame that made it. */
    private fun sendResolve(reply: (String) -> Unit, callId: String, result: Any) {
        val json = if (result is JSONObject) result.toString() else JSONObject.quote(result.toString())
        post(reply, JSONObject().put("type", "resolve").put("callId", callId).put("data", json))
    }

    /** Rejects a pending call in the frame that made it. */
    private fun sendReject(
            reply: (String) -> Unit,
            callId: String,
            code: String,
            message: String,
            nativeStack: String? = null
    ) {
        val error = JSONObject().put("code", code).put("message", message)
        if (BuildConfig.DEBUG && nativeStack != null) error.put("nativeStack", nativeStack)
        post(reply, JSONObject().put("type", "reject").put("callId", callId).put("data", error.toString()))
    }

    private fun post(reply: (String) -> Unit, message: JSONObject) {
        onMain { reply(message.toString()) }
    }
}

private fun mainThreadRunner(): (() -> Unit) -> Unit {
    val handler = Handler(Looper.getMainLooper())
    return { block -> handler.post(block) }
}

private fun bridgeThreadRunner(): (() -> Unit) -> Unit {
    val executor = Executors.newSingleThreadExecutor { Thread(it, "WefterBridge") }
    return { block -> executor.execute(block) }
}
