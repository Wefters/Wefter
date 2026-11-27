package dev.wefter.bridge

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import android.webkit.WebView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import org.json.JSONObject

/** Name of the message channel the page uses to hand files to the app. */
private const val CHANNEL = "WefterDownloads"

/**
 * Runs in the app's own pages. Downloads a plain web view cannot save itself (`<a download>` links to
 * `blob:` and `data:` URLs and to the app's own files, including ones created and clicked from script) are
 * read by the page and sent to the app in pieces over the [CHANNEL] channel, which only the app's own
 * origins can reach. `__wefterSaveDownload(url, name)` lets the app start one from its download listener.
 */
private val DOWNLOAD_SCRIPT =
        """
(function () {
  if (window.__wefterSaveDownload) return;
  var channel = window.$CHANNEL;
  if (!channel) return;
  var CHUNK = 512 * 1024;
  var nextId = 0;

  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function save(href, name) {
    var id = Date.now() + '-' + (++nextId);
    var response = fetch(href);
    return response
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        channel.postMessage(JSON.stringify({ type: 'start', id: id, name: name, mimeType: blob.type || '' }));
        var offset = 0;
        function next() {
          if (offset >= blob.size) {
            channel.postMessage(JSON.stringify({ type: 'end', id: id }));
            return;
          }
          var piece = blob.slice(offset, offset + CHUNK);
          offset += CHUNK;
          return piece.arrayBuffer().then(function (buffer) {
            channel.postMessage(JSON.stringify({ type: 'chunk', id: id, data: toBase64(buffer) }));
            return next();
          });
        }
        return next();
      })
      .catch(function (error) {
        channel.postMessage(JSON.stringify({ type: 'error', id: id, name: name, message: String((error && error.message) || error) }));
      });
  }

  function fileName(anchor, url) {
    var name = anchor.getAttribute('download');
    if (name) return name;
    if (url.protocol === 'blob:' || url.protocol === 'data:') return '';
    var segments = url.pathname.split('/');
    return decodeURIComponent(segments[segments.length - 1] || '');
  }

  function savable(anchor) {
    if (!anchor || !anchor.hasAttribute('download') || !anchor.href) return null;
    var url;
    try { url = new URL(anchor.href, location.href); } catch (e) { return null; }
    if (url.protocol === 'blob:' || url.protocol === 'data:' || url.origin === location.origin) return url;
    return null;
  }

  window.addEventListener('click', function (event) {
    if (event.defaultPrevented || !event.target || !event.target.closest) return;
    var anchor = event.target.closest('a[download]');
    var url = savable(anchor);
    if (!url) return;
    event.preventDefault();
    save(anchor.href, fileName(anchor, url));
  });

  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var url = !this.isConnected && savable(this);
    if (url) {
      save(this.href, fileName(this, url));
      return;
    }
    return click.call(this);
  };

  window.__wefterSaveDownload = save;
})();
"""

/**
 * Saves files the web page downloads into the device's Downloads folder, and says so in a short message.
 *
 * Files from the app's own pages come through the page (see [DOWNLOAD_SCRIPT]), since only the page can
 * read `blob:` URLs and the bundled files. Files from other sites go to Android's download manager, with
 * the page's cookies. Android 9 and older keep them in the app's own Downloads folder, listed in the
 * Downloads app, since writing to the shared one would need a storage permission.
 */
internal class WebDownloads(private val activity: AppCompatActivity) {
    private class Pending(val file: File, val name: String, val mimeType: String, val output: FileOutputStream)

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    /** Downloads being received, by id. Only touched on [io]. */
    private val pending = mutableMapOf<String, Pending>()
    private val tempDir by lazy { File(activity.cacheDir, "wefter-downloads").apply { mkdirs() } }

    /**
     * Sets up [webView]: the page script and its channel for [ownOrigins] (such as
     * `https://appassets.androidplatform.net`), and a download listener for everything else.
     *
     * @return Whether the page script must be run after each page load, since this web view cannot add it
     *   at document start.
     */
    fun attach(webView: WebView, ownOrigins: Set<String>, isOwnOrigin: (Uri) -> Boolean): Boolean {
        var injectAfterLoad = false
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, CHANNEL, ownOrigins) { _, message, _, _, _ ->
                message.data?.let { onMessage(it) }
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(webView, DOWNLOAD_SCRIPT, ownOrigins)
            } else {
                injectAfterLoad = true
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val uri = Uri.parse(url)
            val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val scheme = uri.scheme?.lowercase()
            if (scheme == "blob" || scheme == "data" || isOwnOrigin(uri)) {
                val call = "window.__wefterSaveDownload && window.__wefterSaveDownload(" +
                        "${JSONObject.quote(url)}, ${JSONObject.quote(name)})"
                webView.evaluateJavascript(call, null)
            } else if (scheme == "http" || scheme == "https") {
                enqueue(uri, name, mimeType, userAgent)
            }
        }
        return injectAfterLoad
    }

    /** Runs the page script in [webView]'s current page; for web views without document start scripts. */
    fun injectInto(webView: WebView) {
        webView.evaluateJavascript(DOWNLOAD_SCRIPT, null)
    }

    /** Hands a file from another site to the download manager, which shows its progress. */
    private fun enqueue(uri: Uri, name: String, mimeType: String?, userAgent: String?) {
        val request =
                DownloadManager.Request(uri)
                        .setTitle(name)
                        .setMimeType(mimeType)
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        userAgent?.let { request.addRequestHeader("User-Agent", it) }
        CookieManager.getInstance().getCookie(uri.toString())?.let { request.addRequestHeader("Cookie", it) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        } else {
            request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, name)
        }
        try {
            (activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            toast(WefterText.get(activity, "downloads.downloading", mapOf("name" to name)))
        } catch (e: Exception) {
            toast(WefterText.get(activity, "downloads.failed", mapOf("name" to name)))
        }
    }

    /** A message from [DOWNLOAD_SCRIPT]: a download starting, a piece of it, its end, or an error. */
    private fun onMessage(data: String) {
        val message =
                try {
                    JSONObject(data)
                } catch (e: Exception) {
                    return
                }
        val id = message.optString("id")
        io.execute {
            try {
                when (message.optString("type")) {
                    "start" -> start(id, message.optString("name"), message.optString("mimeType"))
                    "chunk" -> pending[id]?.output?.write(Base64.decode(message.optString("data"), Base64.DEFAULT))
                    "end" -> finish(id)
                    "error" -> {
                        discard(id)
                        toast(
                                message.optString("name").takeIf { it.isNotEmpty() }
                                        ?.let { WefterText.get(activity, "downloads.failed", mapOf("name" to it)) }
                                        ?: WefterText.get(activity, "downloads.failedFile")
                        )
                    }
                }
            } catch (e: Exception) {
                discard(id)
                toast(WefterText.get(activity, "downloads.saveFailed"))
            }
        }
    }

    private fun start(id: String, requestedName: String, requestedMimeType: String) {
        discard(id)
        val mimeType = requestedMimeType.substringBefore(";").trim().ifEmpty { null }
        val name = safeFileName(requestedName, mimeType)
        val type =
                mimeType
                        ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', ""))
                        ?: "application/octet-stream"
        val file = File(tempDir, id)
        pending[id] = Pending(file, name, type, FileOutputStream(file))
    }

    private fun finish(id: String) {
        val download = pending.remove(id) ?: return
        download.output.close()
        try {
            save(download.file, download.name, download.mimeType)
            toast(WefterText.get(activity, "downloads.saved", mapOf("name" to download.name)))
        } finally {
            download.file.delete()
        }
    }

    private fun discard(id: String) {
        pending.remove(id)?.let {
            it.output.close()
            it.file.delete()
        }
    }

    /** Copies [file] into Downloads as [name]; a name already taken gets a number added. */
    private fun save(file: File, name: String, mimeType: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = activity.contentResolver
            val values =
                    ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, name)
                        put(MediaStore.Downloads.MIME_TYPE, mimeType)
                        put(MediaStore.Downloads.IS_PENDING, 1)
                    }
            val item =
                    resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                            ?: throw IllegalStateException("Downloads is not available")
            try {
                resolver.openOutputStream(item)?.use { out -> file.inputStream().use { it.copyTo(out) } }
                        ?: throw IllegalStateException("Downloads is not writable")
                resolver.update(item, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            } catch (e: Exception) {
                resolver.delete(item, null, null)
                throw e
            }
        } else {
            val dir =
                    activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                            ?: throw IllegalStateException("Downloads is not available")
            dir.mkdirs()
            val target = uniqueFile(dir, name)
            file.copyTo(target)
            @Suppress("DEPRECATION")
            (activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).addCompletedDownload(
                    target.name,
                    target.name,
                    true,
                    mimeType,
                    target.absolutePath,
                    target.length(),
                    true
            )
        }
    }

    private fun uniqueFile(dir: File, name: String): File {
        val base = name.substringBeforeLast('.', name)
        val extension = name.substringAfterLast('.', "").let { if (it.isEmpty()) "" else ".$it" }
        var candidate = File(dir, name)
        var n = 1
        while (candidate.exists()) candidate = File(dir, "$base (${n++})$extension")
        return candidate
    }

    /** A file name without path separators, with an extension for its MIME type when it has none. */
    private fun safeFileName(requested: String, mimeType: String?): String {
        var name = requested.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[\\u0000-\\u001f:*?\"<>|]"), "_").trim()
        if (name.isEmpty() || name == "." || name == "..") name = "download"
        if (!name.contains('.') && mimeType != null) {
            MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)?.let { name = "$name.$it" }
        }
        return name.take(120)
    }

    private fun toast(message: String) {
        main.post { Toast.makeText(activity, message, Toast.LENGTH_SHORT).show() }
    }
}
