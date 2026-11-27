package dev.wefter.bridge

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.provider.Settings
import android.webkit.WebView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.location.LocationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/** Name of the message channel the page uses to ask whether the device's location is on. */
private const val CHANNEL = "WefterGeolocation"

/**
 * Runs in the app's own pages. Before each `getCurrentPosition()` and `watchPosition()`, asks the app over
 * the [CHANNEL] channel whether the device's location is on (the reply is `<id>:on` or `<id>:off`). When
 * it is off, the request gets `POSITION_UNAVAILABLE` at once; a watch then stays active, and reports
 * positions once location is turned on.
 */
private val GEOLOCATION_SCRIPT =
        """
(function () {
  var channel = window.$CHANNEL;
  var geolocation = navigator.geolocation;
  if (!channel || !geolocation || window.__wefterLocationCheck) return;
  window.__wefterLocationCheck = true;
  var getCurrentPosition = geolocation.getCurrentPosition;
  var watchPosition = geolocation.watchPosition;
  var clearWatch = geolocation.clearWatch;
  var nextCheck = 1;
  var checks = {};
  var nextWatch = 1;
  var watches = {};

  channel.addEventListener('message', function (event) {
    var reply = String(event.data).split(':');
    var done = checks[reply[0]];
    delete checks[reply[0]];
    if (done) done(reply[1] === 'on');
  });

  function whenChecked(callback) {
    var id = nextCheck++;
    checks[id] = callback;
    channel.postMessage(String(id));
  }

  function reportOff(error) {
    if (typeof error !== 'function') return;
    var proto = window.GeolocationPositionError ? GeolocationPositionError.prototype : Object.prototype;
    error(Object.create(proto, {
      code: { value: 2, enumerable: true },
      message: { value: 'Location services are off', enumerable: true }
    }));
  }

  geolocation.getCurrentPosition = function (success, error, options) {
    if (typeof success !== 'function') return getCurrentPosition.call(geolocation, success, error, options);
    whenChecked(function (on) {
      if (on) getCurrentPosition.call(geolocation, success, error, options);
      else reportOff(error);
    });
  };

  geolocation.watchPosition = function (success, error, options) {
    if (typeof success !== 'function') return watchPosition.call(geolocation, success, error, options);
    var id = nextWatch++;
    watches[id] = null;
    whenChecked(function (on) {
      if (!(id in watches)) return;
      if (!on) reportOff(error);
      watches[id] = watchPosition.call(geolocation, success, error, options);
    });
    return id;
  };

  geolocation.clearWatch = function (id) {
    if (!(id in watches)) return;
    var watch = watches[id];
    delete watches[id];
    if (watch !== null) clearWatch.call(geolocation, watch);
  };
})();
"""

/**
 * `navigator.geolocation` when the device's location is off. The web view alone then never answers: a
 * watch waits without end, and `getCurrentPosition()` until its `timeout`. Here, the page gets
 * `POSITION_UNAVAILABLE` ("Location services are off") at once, and the user is offered the location
 * settings, as Chrome does. After "Not now", it is offered again once the app has been in the background.
 */
internal class WebGeolocation(private val activity: AppCompatActivity) {
    private val locationManager = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private var offer: AlertDialog? = null
    private var declined = false

    init {
        activity.lifecycle.addObserver(
                LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_START) declined = false }
        )
    }

    /**
     * Answers [webView]'s pages from [ownOrigins].
     *
     * @return Whether the page script must be run after each page load, since this web view cannot add it
     *   at document start.
     */
    fun attach(webView: WebView, ownOrigins: Set<String>): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        WebViewCompat.addWebMessageListener(webView, CHANNEL, ownOrigins) { _, message, _, _, reply ->
            val id = message.data?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) } ?: return@addWebMessageListener
            val on = LocationManagerCompat.isLocationEnabled(locationManager)
            reply.postMessage("$id:${if (on) "on" else "off"}")
            if (!on) offerSettings()
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, GEOLOCATION_SCRIPT, ownOrigins)
            return false
        }
        return true
    }

    /** Runs the page script in [webView]'s current page; for web views without document start scripts. */
    fun injectInto(webView: WebView) {
        webView.evaluateJavascript(GEOLOCATION_SCRIPT, null)
    }

    /** Asks the user to turn location on in the system settings, unless already asking or told "Not now". */
    private fun offerSettings() {
        if (declined || offer?.isShowing == true || activity.isFinishing || activity.isDestroyed) return
        offer =
                AlertDialog.Builder(activity, androidx.appcompat.R.style.Theme_AppCompat_DayNight_Dialog_Alert)
                        .setTitle(WefterText.get(activity, "location.off.title"))
                        .setMessage(WefterText.get(activity, "location.off.message"))
                        .setPositiveButton(WefterText.get(activity, "location.off.settings")) { _, _ -> openSettings() }
                        .setNegativeButton(WefterText.get(activity, "location.off.notNow")) { _, _ -> declined = true }
                        .setOnCancelListener { declined = true }
                        .create()
                        .apply { setCanceledOnTouchOutside(false) }
                        .also { it.show() }
    }

    private fun openSettings() {
        try {
            activity.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            activity.startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }
}
