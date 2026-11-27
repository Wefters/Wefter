package dev.wefter.bridge

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.provider.MediaStore
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import org.json.JSONObject

/** How long photos and videos taken for `<input type="file">` are kept before they are cleaned up. */
private const val CAPTURE_MAX_AGE_MS = 24 * 60 * 60 * 1000L

/**
 * Gives the web page the browser features a plain `WebView` lacks:
 *
 * - `alert()`, `confirm()` and `prompt()` as native dialogs.
 * - `<input type="file">`: the system file picker. When images or videos are accepted, a menu also offers
 *   taking a photo or video; `capture` opens the camera directly.
 * - `getUserMedia()` camera and microphone, and `navigator.geolocation`, after asking for the Android
 *   permission. The app must declare it (`permissions` in `wefter.config.json`); in debug builds the page's
 *   console says so when it does not.
 * - Fullscreen video and the Fullscreen API.
 *
 * Only the app's own pages ([isOwnOrigin]) may use the camera, microphone and location.
 *
 * Create it in `onCreate`, before the activity starts, as Android requires for result launchers.
 */
internal class WefterChromeClient(
        private val activity: AppCompatActivity,
        private val permissions: RuntimePermissions,
        private val fullscreenContainer: FrameLayout,
        private val webView: () -> WebView,
        private val isOwnOrigin: (Uri) -> Boolean,
) : WebChromeClient() {
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    /** Where the camera app writes the photo or video it takes for the open file picker. */
    private val captureFiles = mutableListOf<File>()

    private var fullscreenView: View? = null
    private var fullscreenCallback: CustomViewCallback? = null
    /** Leaves fullscreen on back. Added when fullscreen starts, so it runs before every other back handler. */
    private var fullscreenBack: OnBackPressedCallback? = null

    private val fileLauncher =
            activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
                deliverFiles(result.resultCode, result.data)
            }

    // Dialogs

    /** Dialogs follow the system's light or dark mode. */
    private fun dialogBuilder() =
            AlertDialog.Builder(activity, androidx.appcompat.R.style.Theme_AppCompat_DayNight_Dialog_Alert)

    private fun canShowDialog() = !activity.isFinishing && !activity.isDestroyed

    override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
        if (!canShowDialog()) {
            result.cancel()
            return true
        }
        dialogBuilder()
                .setMessage(message)
                .setPositiveButton(WefterText.get(activity, "dialog.ok")) { _, _ -> result.confirm() }
                .setOnCancelListener { result.cancel() }
                .create()
                .apply { setCanceledOnTouchOutside(false) }
                .show()
        return true
    }

    override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
        if (!canShowDialog()) {
            result.cancel()
            return true
        }
        dialogBuilder()
                .setMessage(message)
                .setPositiveButton(WefterText.get(activity, "dialog.ok")) { _, _ -> result.confirm() }
                .setNegativeButton(WefterText.get(activity, "dialog.cancel")) { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }
                .create()
                .apply { setCanceledOnTouchOutside(false) }
                .show()
        return true
    }

    override fun onJsPrompt(
            view: WebView,
            url: String,
            message: String,
            defaultValue: String?,
            result: JsPromptResult
    ): Boolean {
        if (!canShowDialog()) {
            result.cancel()
            return true
        }
        val input =
                EditText(activity).apply {
                    setText(defaultValue ?: "")
                    setSingleLine()
                    selectAll()
                }
        val padding = (20 * activity.resources.displayMetrics.density).toInt()
        val frame =
                FrameLayout(activity).apply {
                    setPadding(padding, padding / 2, padding, 0)
                    addView(input)
                }
        dialogBuilder()
                .setMessage(message)
                .setView(frame)
                .setPositiveButton(WefterText.get(activity, "dialog.ok")) { _, _ -> result.confirm(input.text.toString()) }
                .setNegativeButton(WefterText.get(activity, "dialog.cancel")) { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }
                .create()
                .apply {
                    setCanceledOnTouchOutside(false)
                    window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
                    input.requestFocus()
                }
                .show()
        return true
    }

    // File picker

    override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams
    ): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = filePathCallback
        captureFiles.clear()

        val mimeTypes = acceptedMimeTypes(fileChooserParams.acceptTypes)
        val acceptsAny = mimeTypes.isEmpty()
        val acceptsImages = acceptsAny || mimeTypes.any { it.startsWith("image/") }
        val acceptsVideos = acceptsAny || mimeTypes.any { it.startsWith("video/") }
        val capture = fileChooserParams.isCaptureEnabled && (acceptsImages || acceptsVideos)

        val canTakePhoto = acceptsImages && hasCameraApp(MediaStore.ACTION_IMAGE_CAPTURE)
        val canRecordVideo = acceptsVideos && hasCameraApp(MediaStore.ACTION_VIDEO_CAPTURE)
        val content = contentIntent(mimeTypes, fileChooserParams)

        when {
            capture && canTakePhoto -> launchCamera(MediaStore.ACTION_IMAGE_CAPTURE, "jpg")
            capture && canRecordVideo -> launchCamera(MediaStore.ACTION_VIDEO_CAPTURE, "mp4")
            canTakePhoto || canRecordVideo -> showSourceMenu(content, canTakePhoto, canRecordVideo)
            else -> launch(content)
        }
        return true
    }

    /**
     * Asks where the file should come from: a new photo, a new video, or the file picker (which also
     * reaches the photo library and cloud drives).
     */
    private fun showSourceMenu(content: Intent, canTakePhoto: Boolean, canRecordVideo: Boolean) {
        if (!canShowDialog()) {
            deliverFiles(Activity.RESULT_CANCELED, null)
            return
        }
        val options = mutableListOf<Pair<String, () -> Unit>>()
        if (canTakePhoto) options += WefterText.get(activity, "files.takePhoto") to { launchCamera(MediaStore.ACTION_IMAGE_CAPTURE, "jpg") }
        if (canRecordVideo) options += WefterText.get(activity, "files.recordVideo") to { launchCamera(MediaStore.ACTION_VIDEO_CAPTURE, "mp4") }
        options += WefterText.get(activity, "files.browse") to { launch(content) }

        dialogBuilder()
                .setItems(options.map { it.first }.toTypedArray()) { _, which -> options[which].second() }
                .setOnCancelListener { deliverFiles(Activity.RESULT_CANCELED, null) }
                .show()
    }

    /** Whether an app can take a photo or video for [action]. */
    private fun hasCameraApp(action: String): Boolean =
            Intent(action).resolveActivity(activity.packageManager) != null

    /** Opens the camera app for [action], after the camera permission when the app declares it. */
    private fun launchCamera(action: String, extension: String) {
        withCamera { allowed ->
            if (allowed) launch(captureIntent(action, extension))
            else deliverFiles(Activity.RESULT_CANCELED, null)
        }
    }

    /**
     * Calls [onReady] with whether the camera may be used. An app that declares the `CAMERA` permission
     * (for `getUserMedia` or a plugin) must hold it before another app's camera may take a photo for it;
     * otherwise no permission is involved.
     */
    private fun withCamera(onReady: (Boolean) -> Unit) {
        if (!permissions.isDeclared(Manifest.permission.CAMERA)) {
            onReady(true)
            return
        }
        permissions.requestGranted(listOf(Manifest.permission.CAMERA)) { granted ->
            onReady(Manifest.permission.CAMERA in granted)
        }
    }

    /**
     * MIME types from the `accept` attribute, with file extensions (`.pdf`) turned into MIME types. Empty
     * when anything is accepted, including when an extension has no known MIME type.
     */
    private fun acceptedMimeTypes(acceptTypes: Array<String>?): List<String> {
        val entries =
                acceptTypes.orEmpty().flatMap { it.split(",") }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        val mimeTypes = mutableListOf<String>()
        for (entry in entries) {
            val mimeType =
                    if (entry.startsWith(".")) {
                        MimeTypeMap.getSingleton().getMimeTypeFromExtension(entry.removePrefix("."))
                                ?: return emptyList()
                    } else entry
            if (mimeType == "*/*") return emptyList()
            if (mimeType !in mimeTypes) mimeTypes += mimeType
        }
        return mimeTypes
    }

    /** The system file picker for [mimeTypes] (anything when empty), allowing several files if asked. */
    private fun contentIntent(mimeTypes: List<String>, params: FileChooserParams): Intent =
            Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mimeTypes.singleOrNull() ?: "*/*"
                if (mimeTypes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
            }

    /**
     * A camera intent that writes into a new file in the cache, shared with the camera app through the
     * app's file provider.
     */
    private fun captureIntent(action: String, extension: String): Intent {
        val dir = File(activity.cacheDir, "wefter-capture").apply { mkdirs() }
        val now = System.currentTimeMillis()
        dir.listFiles()?.filter { now - it.lastModified() > CAPTURE_MAX_AGE_MS }?.forEach { it.delete() }

        val file = File(dir, "capture-$now.$extension")
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.wefter.files", file)
        val intent =
                Intent(action).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    clipData = ClipData.newRawUri("", uri)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
        captureFiles += file
        return intent
    }

    /** Opens the file picker or camera app; when none can open, the page gets no files. */
    private fun launch(intent: Intent) {
        try {
            fileLauncher.launch(intent)
        } catch (e: ActivityNotFoundException) {
            deliverFiles(Activity.RESULT_CANCELED, null)
        }
    }

    /** Hands the picked files, or the photo or video just taken, to the page; nothing when cancelled. */
    private fun deliverFiles(resultCode: Int, data: Intent?) {
        val callback = fileCallback ?: return
        fileCallback = null
        val capture = captureFiles.firstOrNull { it.length() > 0 }
        captureFiles.filter { it.length() == 0L }.forEach { it.delete() }
        captureFiles.clear()

        if (resultCode != Activity.RESULT_OK) {
            callback.onReceiveValue(null)
            return
        }

        val uris = mutableListOf<Uri>()
        data?.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris += it } }
        if (uris.isEmpty()) data?.data?.let { uris += it }
        if (uris.isEmpty() && capture != null) {
            uris += FileProvider.getUriForFile(activity, "${activity.packageName}.wefter.files", capture)
        }
        callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    // Camera, microphone and location

    override fun onPermissionRequest(request: PermissionRequest) {
        if (!isOwnOrigin(request.origin)) {
            request.deny()
            return
        }
        val needed =
                request.resources.associateWith { resource ->
                    when (resource) {
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                        else -> null
                    }
                }
        val androidPermissions = needed.values.filterNotNull().distinct()
        if (androidPermissions.isEmpty()) {
            request.deny()
            return
        }
        warnIfUndeclared(Manifest.permission.CAMERA, "camera", "getUserMedia({ video })", androidPermissions)
        warnIfUndeclared(Manifest.permission.RECORD_AUDIO, "microphone", "getUserMedia({ audio })", androidPermissions)

        permissions.requestGranted(androidPermissions) { granted ->
            val grantable = needed.filterValues { it != null && it in granted }.keys.toTypedArray()
            if (grantable.isEmpty()) request.deny() else request.grant(grantable)
        }
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
        if (!isOwnOrigin(Uri.parse(origin))) {
            callback.invoke(origin, false, false)
            return
        }
        val location = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (location.none { permissions.isDeclared(it) }) {
            warnInConsole(undeclaredMessage("location", "navigator.geolocation"))
        }
        permissions.requestGranted(location) { granted -> callback.invoke(origin, granted.isNotEmpty(), false) }
    }

    private fun warnIfUndeclared(permission: String, feature: String, api: String, requested: List<String>) {
        if (permission in requested && !permissions.isDeclared(permission)) {
            warnInConsole(undeclaredMessage(feature, api))
        }
    }

    private fun undeclaredMessage(feature: String, api: String) =
            "[Wefter] $api was denied: the app does not declare the $feature permission. " +
                    "Add \"permissions\": { \"$feature\": \"<why the app needs it>\" } to wefter.config.json " +
                    "and run wefter sync."

    /** Logs [message] as a warning in the page's console, in debug builds. */
    private fun warnInConsole(message: String) {
        if (!BuildConfig.DEBUG) return
        webView().evaluateJavascript("console.warn(${JSONObject.quote(message)})", null)
    }

    // Video

    /** No poster for videos without one, as in browsers, instead of the web view's grey play icon. */
    override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

    // Fullscreen

    override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        if (fullscreenView != null) {
            callback.onCustomViewHidden()
            return
        }
        fullscreenView = view
        fullscreenCallback = callback
        view.setBackgroundColor(Color.BLACK)
        fullscreenContainer.addView(
                view,
                ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        WindowCompat.getInsetsController(activity.window, view).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
        fullscreenBack =
                object : OnBackPressedCallback(true) {
                    override fun handleOnBackPressed() {
                        exitFullscreen()
                    }
                }.also { activity.onBackPressedDispatcher.addCallback(activity, it) }
    }

    override fun onHideCustomView() {
        val view = fullscreenView ?: return
        fullscreenView = null
        fullscreenBack?.remove()
        fullscreenBack = null
        fullscreenContainer.removeView(view)
        WindowCompat.getInsetsController(activity.window, fullscreenContainer)
                .show(WindowInsetsCompat.Type.systemBars())
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
    }

    /** Leaves fullscreen, as the back button does. */
    fun exitFullscreen() {
        onHideCustomView()
    }
}
