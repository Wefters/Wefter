package dev.wefter.bridge

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Parent of every native plugin. Subclasses expose annotated methods to JavaScript and settle each call
 * with [resolve] or [reject].
 */
abstract class WefterPlugin(
        protected val context: Context,
        protected val dispatcher: BridgeDispatcher
) {
    /** Completes a call successfully with [data]. */
    protected fun resolve(callback: (Result<Any>) -> Unit, data: JSONObject = JSONObject()) =
            callback(Result.success(data))

    /** Fails a call with an error [code] and [message]. */
    protected fun reject(callback: (Result<Any>) -> Unit, code: String, message: String) =
            callback(Result.failure(WefterError(code, message)))

    /** Sends an event to JavaScript listeners registered with `registerHook(hookName, …)`. */
    protected fun emit(hookName: String, data: JSONObject) = dispatcher.emit(hookName, data)

    /** Whether the app holds [permission]. */
    protected fun hasPermission(permission: String): Boolean =
            ContextCompat.checkSelfPermission(context, permission) ==
                    PackageManager.PERMISSION_GRANTED

    /** Asks the user for [permission] and reports whether it was granted. */
    protected fun requestPermission(
            activity: Activity,
            permission: String,
            onResult: (granted: Boolean) -> Unit
    ) = dispatcher.requestPermission(activity, permission, onResult)
}
