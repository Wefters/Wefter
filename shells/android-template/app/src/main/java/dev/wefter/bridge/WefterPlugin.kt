package dev.wefter.bridge

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import org.json.JSONObject

abstract class WefterPlugin(
        protected val context: Context,
        protected val dispatcher: BridgeDispatcher
) {
    protected fun resolve(callback: (Result<Any>) -> Unit, data: JSONObject = JSONObject()) =
            callback(Result.success(data))

    protected fun reject(callback: (Result<Any>) -> Unit, code: String, message: String) =
            callback(Result.failure(WefterError(code, message)))

    protected fun emit(hookName: String, data: JSONObject) = dispatcher.emit(hookName, data)

    protected fun hasPermission(permission: String): Boolean =
            ContextCompat.checkSelfPermission(context, permission) ==
                    PackageManager.PERMISSION_GRANTED

    protected fun requestPermission(
            activity: Activity,
            permission: String,
            onResult: (granted: Boolean) -> Unit
    ) = dispatcher.requestPermission(activity, permission, onResult)
}
