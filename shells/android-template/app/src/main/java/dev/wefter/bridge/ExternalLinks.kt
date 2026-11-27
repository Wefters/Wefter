package dev.wefter.bridge

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import java.net.URISyntaxException

/**
 * Opens links the web view does not load itself in the app that handles them: web pages in the browser,
 * `tel:`, `mailto:`, `sms:`, `geo:` and other app links in their apps, and Android `intent:` links in the
 * app they name (or their fallback page when it is not installed).
 */
internal object ExternalLinks {
    /** Schemes that must never be handed to another app. */
    private val BLOCKED_SCHEMES = setOf("javascript", "file", "content", "about", "data", "blob")

    /**
     * Opens [uri] outside the app. A link no app can open shows a short message; blocked schemes are
     * ignored.
     */
    fun open(activity: Activity, uri: Uri) {
        val scheme = uri.scheme?.lowercase() ?: return
        if (scheme in BLOCKED_SCHEMES) return

        if (scheme == "intent") {
            openIntentLink(activity, uri.toString())
            return
        }

        val intent = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        if (!start(activity, intent)) noAppFound(activity)
    }

    /**
     * Starts the app an `intent:` link names, limited to what a browser allows (no explicit component or
     * URI permissions). When that app is not installed, opens `S.browser_fallback_url` or the app's Play
     * Store page.
     */
    private fun openIntentLink(activity: Activity, link: String) {
        val intent =
                try {
                    Intent.parseUri(link, Intent.URI_INTENT_SCHEME)
                } catch (e: URISyntaxException) {
                    return
                }
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        intent.component = null
        intent.selector = null
        intent.flags =
                intent.flags and
                        (Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                                        Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
                                .inv()
        if (start(activity, intent)) return

        val fallback = intent.getStringExtra("browser_fallback_url")?.let { Uri.parse(it) }
        if (fallback != null && (fallback.scheme == "https" || fallback.scheme == "http")) {
            if (start(activity, Intent(Intent.ACTION_VIEW, fallback))) return
        }
        val packageName = intent.`package`
        if (packageName != null &&
                        start(activity, Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName")))
        ) {
            return
        }
        noAppFound(activity)
    }

    private fun start(activity: Activity, intent: Intent): Boolean =
            try {
                activity.startActivity(intent)
                true
            } catch (e: ActivityNotFoundException) {
                false
            } catch (e: SecurityException) {
                false
            }

    private fun noAppFound(activity: Activity) {
        Toast.makeText(activity, "No app can open this link", Toast.LENGTH_SHORT).show()
    }
}
