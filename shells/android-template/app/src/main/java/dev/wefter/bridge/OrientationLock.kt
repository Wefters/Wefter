package dev.wefter.bridge

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import java.lang.ref.WeakReference

/**
 * Locks the screen to an orientation while the app runs (a video player in landscape, for example) and
 * returns to the app's own orientation (`orientation` in `wefter.config.json`) on [unlock]. Used by the
 * `@wefterjs/screen` plugin. Android 16 ignores locks on large screens such as tablets.
 */
object OrientationLock {
    private var activity: WeakReference<Activity>? = null

    /** Orientation names as the Screen Orientation API writes them. */
    private val orientations =
            mapOf(
                    "portrait" to ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT,
                    "portrait-primary" to ActivityInfo.SCREEN_ORIENTATION_PORTRAIT,
                    "portrait-secondary" to ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT,
                    "landscape" to ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,
                    "landscape-primary" to ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE,
                    "landscape-secondary" to ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE,
                    "any" to ActivityInfo.SCREEN_ORIENTATION_FULL_USER,
            )

    /** Names [lock] accepts. */
    val names: Set<String> = orientations.keys

    /** Sets the screen whose orientation is locked. Called by `MainActivity`. */
    internal fun attach(activity: Activity) {
        this.activity = WeakReference(activity)
    }

    /**
     * Locks the screen to [orientation] (`portrait`, `landscape`, their `-primary`/`-secondary` forms, or
     * `any`). Must be called on the main thread.
     *
     * @return `false` when [orientation] is unknown or the app's screen is gone.
     */
    fun lock(orientation: String): Boolean {
        val value = orientations[orientation] ?: return false
        val current = activity?.get() ?: return false
        current.requestedOrientation = value
        return true
    }

    /** Returns to the app's own orientation. Must be called on the main thread. */
    fun unlock(): Boolean {
        val current = activity?.get() ?: return false
        current.requestedOrientation = appOrientation(current)
        return true
    }

    /** The orientation the app's manifest gives its screen. */
    private fun appOrientation(activity: Activity): Int =
            try {
                @Suppress("DEPRECATION")
                activity.packageManager.getActivityInfo(activity.componentName, 0).screenOrientation
            } catch (_: PackageManager.NameNotFoundException) {
                ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
}
