package dev.wefter.bridge

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Where a permission stands, as plugins report it to JavaScript (`checkPermissions()`):
 *
 * - [GRANTED]: the app may use it.
 * - [PROMPT]: asking shows the system prompt.
 * - [DENIED]: only the system settings can change it (the user declined for good, or the app does not
 *   declare the permission).
 * - [LIMITED]: partly granted, such as the photos and videos the user picked (Android 14 and later).
 */
enum class PermissionState(val jsName: String) {
    GRANTED("granted"),
    PROMPT("prompt"),
    DENIED("denied"),
    LIMITED("limited");

    override fun toString(): String = jsName
}

/**
 * Asks for Android runtime permissions, for plugins and for the web page (camera, microphone, location),
 * one request at a time. Only permissions the app declares in its manifest can be asked for: the others
 * are reported as denied, since Android refuses them without asking.
 *
 * Android only tells whether a permission is granted, and whether to explain it before asking again. To
 * tell "not asked yet" from "declined for good", the permissions the app has asked for are remembered.
 *
 * Create it in `onCreate`, before the activity starts, as Android requires for result launchers.
 */
internal class RuntimePermissions(private val activity: AppCompatActivity) {
    private class Request(val permissions: List<String>, val onResult: (Map<String, PermissionState>) -> Unit)

    private val queue = ArrayDeque<Request>()
    private var current: Request? = null
    private val asked = activity.getSharedPreferences("wefter_permissions", Context.MODE_PRIVATE)

    private val launcher =
            activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
                val request = current
                current = null
                request?.let { done ->
                    asked.edit().apply { done.permissions.forEach { putBoolean(it, true) } }.apply()
                    done.onResult(states(done.permissions))
                }
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

    /** Where [permission] stands now. */
    fun state(permission: String): PermissionState =
            when {
                isGranted(permission) -> PermissionState.GRANTED
                isPartlyGranted(permission) -> PermissionState.LIMITED
                !isDeclared(permission) -> PermissionState.DENIED
                !asked.getBoolean(permission, false) -> PermissionState.PROMPT
                ActivityCompat.shouldShowRequestPermissionRationale(activity, permission) -> PermissionState.PROMPT
                else -> PermissionState.DENIED
            }

    /** Where each of [permissions] stands now. */
    fun states(permissions: List<String>): Map<String, PermissionState> = permissions.associateWith { state(it) }

    /**
     * Asks for those of [permissions] that can still be asked for, and reports where each stands
     * afterwards. Must be called on the main thread.
     */
    fun request(permissions: List<String>, onResult: (Map<String, PermissionState>) -> Unit) {
        val askable = permissions.filter { state(it) == PermissionState.PROMPT || state(it) == PermissionState.LIMITED }
        if (askable.isEmpty()) {
            onResult(states(permissions))
            return
        }
        queue.addLast(Request(permissions.distinct(), onResult))
        if (current == null) startNext()
    }

    /** Like [request], reporting only which of [permissions] are granted. */
    fun requestGranted(permissions: List<String>, onResult: (Set<String>) -> Unit) {
        request(permissions) { states -> onResult(states.filterValues { it == PermissionState.GRANTED }.keys) }
    }

    /** Opens this app's page in the system settings, where the user can change its permissions. */
    fun openAppSettings() {
        val intent =
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            activity.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    /** Photos and videos the user picked on Android 14 and later, rather than all of them. */
    private fun isPartlyGranted(permission: String): Boolean =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
                    (permission == Manifest.permission.READ_MEDIA_IMAGES ||
                            permission == Manifest.permission.READ_MEDIA_VIDEO) &&
                    isGranted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)

    private fun startNext() {
        val next = queue.removeFirstOrNull() ?: return
        val toAsk = next.permissions.filter { state(it) == PermissionState.PROMPT || state(it) == PermissionState.LIMITED }
        if (toAsk.isEmpty()) {
            next.onResult(states(next.permissions))
            startNext()
            return
        }
        current = next
        launcher.launch(toAsk.toTypedArray())
    }
}
