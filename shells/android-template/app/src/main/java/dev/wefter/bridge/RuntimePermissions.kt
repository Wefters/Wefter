package dev.wefter.bridge

import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * Asks for Android runtime permissions on behalf of the web page (camera, microphone, location), one
 * request at a time. Only permissions the app declares in its manifest can be asked for: the others are
 * reported as not granted, since Android refuses them without asking.
 *
 * Create it in `onCreate`, before the activity starts, as Android requires for result launchers.
 */
internal class RuntimePermissions(private val activity: AppCompatActivity) {
    private class Request(val permissions: List<String>, val onResult: (Set<String>) -> Unit)

    private val queue = ArrayDeque<Request>()
    private var current: Request? = null

    private val launcher =
            activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
                val request = current
                current = null
                request?.onResult?.invoke(results.filterValues { it }.keys + grantedOf(request.permissions))
                startNext()
            }

    /** Permissions listed in the app's manifest. */
    private val declared: Set<String> by lazy {
        val info =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    activity.packageManager.getPackageInfo(
                            activity.packageName,
                            PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong())
                    )
                } else {
                    @Suppress("DEPRECATION")
                    activity.packageManager.getPackageInfo(activity.packageName, PackageManager.GET_PERMISSIONS)
                }
        info.requestedPermissions?.toSet() ?: emptySet()
    }

    /** Whether the app's manifest lists [permission]. */
    fun isDeclared(permission: String): Boolean = permission in declared

    /** Whether the user has granted [permission]. */
    fun isGranted(permission: String): Boolean =
            ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED

    /**
     * Asks for the declared ones of [permissions] that are not granted yet, and reports every one of
     * [permissions] that is granted afterwards. Undeclared permissions are never granted.
     */
    fun request(permissions: List<String>, onResult: (Set<String>) -> Unit) {
        val askable = permissions.filter { isDeclared(it) }
        if (askable.isEmpty() || askable.all { isGranted(it) }) {
            onResult(grantedOf(askable))
            return
        }
        queue.addLast(Request(askable, onResult))
        if (current == null) startNext()
    }

    private fun grantedOf(permissions: List<String>): Set<String> = permissions.filter { isGranted(it) }.toSet()

    private fun startNext() {
        val next = queue.removeFirstOrNull() ?: return
        current = next
        launcher.launch(next.permissions.filterNot { isGranted(it) }.toTypedArray())
    }
}
