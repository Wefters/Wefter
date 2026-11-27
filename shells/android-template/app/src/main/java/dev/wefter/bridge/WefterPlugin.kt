package dev.wefter.bridge

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Looper
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContract
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

/**
 * Parent of every native plugin. Subclasses expose annotated methods to JavaScript and settle each call
 * with [resolve] or [reject].
 *
 * A plugin lives as long as the app's screen (`MainActivity`): it is created once, even when the web view
 * is rebuilt after its renderer crashed. Override the `on…` methods to follow the screen's lifecycle.
 */
abstract class WefterPlugin(
        protected val context: Context,
        protected val dispatcher: BridgeDispatcher
) {
    /**
     * The app's screen, for starting other screens and showing dialogs. (Named so it does not clash with an
     * `activity` property a plugin declares itself.)
     */
    protected val appActivity: AppCompatActivity
        get() = context as AppCompatActivity

    /** Completes a call successfully with [data]. */
    protected fun resolve(callback: (Result<Any>) -> Unit, data: JSONObject = JSONObject()) =
            callback(Result.success(data))

    /** Fails a call with an error [code] and [message]. */
    protected fun reject(callback: (Result<Any>) -> Unit, code: String, message: String) =
            callback(Result.failure(WefterError(code, message)))

    /**
     * Sends an event to JavaScript listeners registered with `registerHook(hookName, …)`.
     *
     * With [hold], the event waits in [EventInbox] until the page listens for [hookName], so it is not lost
     * when it happens before the page has loaded (a notification tap that launched the app). Without it,
     * only listeners registered at that moment get it.
     */
    protected fun emit(hookName: String, data: JSONObject, hold: Boolean = false) {
        if (hold) EventInbox.hold(hookName, data) else dispatcher.emit(hookName, data)
    }

    /** The screen came to the front. */
    open fun onResume() {}

    /** The screen went to the background, or another screen covers it. */
    open fun onPause() {}

    /**
     * The app was opened again with [intent] while running (a notification tap, a link). Return `true` when
     * the plugin handled it; otherwise it is treated as a deep link. The intent the app started with is
     * `appActivity.intent`.
     */
    open fun onNewIntent(intent: Intent): Boolean = false

    /** The screen is closing for good; release listeners and resources. */
    open fun onDestroy() {}

    /**
     * Starts another screen with [contract] and [input] (a picker, the camera, a sign-in) and reports its
     * result to [onResult] on the main thread. Unlike `registerForActivityResult`, it can be called at any
     * time. The result is lost if Android ends the app while the other screen is open.
     */
    protected fun <I, O> launchForResult(contract: ActivityResultContract<I, O>, input: I, onResult: (O) -> Unit) {
        runOnMain {
            val key = "wefter.${javaClass.simpleName}.${nextResultKey.incrementAndGet()}"
            var launcher: ActivityResultLauncher<I>? = null
            launcher =
                    appActivity.activityResultRegistry.register(key, contract) { result ->
                        launcher?.unregister()
                        onResult(result)
                    }
            launcher.launch(input)
        }
    }

    /** Whether the app holds [permission]. */
    protected fun hasPermission(permission: String): Boolean =
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /** Where each of [permissions] stands: granted, prompt, denied or limited. */
    protected fun checkPermissions(permissions: List<String>): Map<String, PermissionState> =
            dispatcher.permissions.states(permissions)

    /**
     * Asks for those of [permissions] that can still be asked for, one system prompt at a time across the
     * app, and reports where each stands afterwards, on the main thread.
     */
    protected fun requestPermissions(permissions: List<String>, onResult: (Map<String, PermissionState>) -> Unit) {
        runOnMain { dispatcher.permissions.request(permissions, onResult) }
    }

    /** Opens this app's page in the system settings, where the user can change its permissions. */
    protected fun openAppSettings() = runOnMain { dispatcher.permissions.openAppSettings() }

    /** Asks the user for [permission] and reports whether it was granted. */
    @Deprecated("Use requestPermissions", ReplaceWith("requestPermissions(listOf(permission)) { onResult(it[permission] == PermissionState.GRANTED) }"))
    protected fun requestPermission(
            @Suppress("UNUSED_PARAMETER") activity: Activity,
            permission: String,
            onResult: (granted: Boolean) -> Unit
    ) = requestPermissions(listOf(permission)) { onResult(it[permission] == PermissionState.GRANTED) }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else appActivity.runOnUiThread(block)
    }

    private companion object {
        val nextResultKey = AtomicInteger()
    }
}
