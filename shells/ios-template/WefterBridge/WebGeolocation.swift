import CoreLocation
import WebKit

/// `navigator.geolocation` for the app's own pages, answered by Core Location.
///
/// WebKit's own implementation asks twice, once in iOS's permission alert and again in its own alert naming
/// the page's origin. This one asks once, with the app's usage description (`permissions.location` in
/// `wefter.config.json`), and keeps the standard API: `getCurrentPosition`, `watchPosition` and
/// `clearWatch` with their `enableHighAccuracy`, `timeout` and `maximumAge` options.
///
/// When Location Services are off, requests get `POSITION_UNAVAILABLE` ("Location services are off") rather
/// than a denial, iOS offers to turn them on, and watches resume once they are.
final class WebGeolocation: NSObject, WKScriptMessageHandler, CLLocationManagerDelegate {
    static let messageHandlerName = "wefterGeolocation"

    /// Replaces `navigator.geolocation` in the page with one that asks the app.
    static let userScript = WKUserScript(
        source: """
        (function () {
          var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.\(messageHandlerName);
          if (!handler || window.__wefterGeolocation) return;
          var nextId = 1;
          var requests = {};
          var lastPosition = null;

          function PositionError(code, message) { this.code = code; this.message = message; }
          PositionError.prototype.PERMISSION_DENIED = PositionError.PERMISSION_DENIED = 1;
          PositionError.prototype.POSITION_UNAVAILABLE = PositionError.POSITION_UNAVAILABLE = 2;
          PositionError.prototype.TIMEOUT = PositionError.TIMEOUT = 3;

          function toPosition(p) {
            var coords = {
              latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy,
              altitude: p.altitude, altitudeAccuracy: p.altitudeAccuracy, heading: p.heading, speed: p.speed
            };
            coords.toJSON = function () { var c = Object.assign({}, coords); delete c.toJSON; return c; };
            return { coords: coords, timestamp: p.timestamp, toJSON: function () { return { coords: coords.toJSON(), timestamp: p.timestamp }; } };
          }

          function armTimeout(id) {
            var request = requests[id];
            if (!request || !(request.timeout >= 0) || request.timeout === Infinity) return;
            clearTimeout(request.timer);
            request.timer = setTimeout(function () {
              if (!requests[id]) return;
              if (!request.watch) finish(id);
              if (request.error) request.error(new PositionError(3, 'Timeout expired'));
            }, request.timeout);
          }

          function finish(id) {
            var request = requests[id];
            if (!request) return;
            clearTimeout(request.timer);
            delete requests[id];
            if (!request.watch) handler.postMessage({ action: 'clear', id: id });
          }

          function start(success, error, options, watch) {
            if (typeof success !== 'function') throw new TypeError('A success callback is required');
            options = options || {};
            var id = nextId++;
            var maximumAge = Number(options.maximumAge) || 0;
            if (lastPosition && maximumAge > 0 && Date.now() - lastPosition.timestamp <= maximumAge) {
              setTimeout(function () { success(lastPosition); });
              if (!watch) return id;
            }
            requests[id] = {
              success: success, error: typeof error === 'function' ? error : null, watch: watch,
              timeout: options.timeout === undefined ? Infinity : Math.max(0, Number(options.timeout) || 0)
            };
            armTimeout(id);
            handler.postMessage({ action: watch ? 'watch' : 'get', id: id, highAccuracy: !!options.enableHighAccuracy });
            return id;
          }

          window.__wefterGeolocation = {
            position: function (ids, p) {
              lastPosition = toPosition(p);
              ids.forEach(function (id) {
                var request = requests[id];
                if (!request) return;
                if (request.watch) armTimeout(id); else finish(id);
                request.success(lastPosition);
              });
            },
            error: function (ids, code, message) {
              ids.forEach(function (id) {
                var request = requests[id];
                if (!request) return;
                if (!request.watch || code === 1) finish(id);
                if (request.error) request.error(new PositionError(code, message));
              });
            }
          };

          var geolocation = {
            getCurrentPosition: function (success, error, options) { start(success, error, options, false); },
            watchPosition: function (success, error, options) { return start(success, error, options, true); },
            clearWatch: function (id) {
              if (!requests[id]) return;
              clearTimeout(requests[id].timer);
              delete requests[id];
              handler.postMessage({ action: 'clear', id: id });
            }
          };
          Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true, enumerable: true });
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    private let manager = CLLocationManager()
    private weak var webView: WKWebView?
    private let isOwnOrigin: (WKSecurityOrigin) -> Bool

    /// Requests waiting for their first position (`getCurrentPosition`), and active watches.
    private var pendingIds: Set<Int> = []
    private var watchIds: Set<Int> = []
    private var highAccuracyIds: Set<Int> = []
    private var awaitingAuthorization = false
    private var updating = false
    /// Whether updates were started only so that iOS offers to turn Location Services on; their failure is
    /// not reported again.
    private var offeringServices = false
    /// Watches already told that Location Services are off.
    private var watchesToldServicesOff: Set<Int> = []

    init(webView: WKWebView, isOwnOrigin: @escaping (WKSecurityOrigin) -> Bool) {
        self.webView = webView
        self.isOwnOrigin = isOwnOrigin
        super.init()
        manager.delegate = self
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.messageHandlerName,
              message.frameInfo.isMainFrame,
              isOwnOrigin(message.frameInfo.securityOrigin),
              let body = message.body as? [String: Any],
              let action = body["action"] as? String,
              let id = (body["id"] as? NSNumber)?.intValue
        else { return }

        switch action {
        case "get", "watch":
            if action == "get" { pendingIds.insert(id) } else { watchIds.insert(id) }
            if (body["highAccuracy"] as? Bool) == true { highAccuracyIds.insert(id) }
            start()
        case "clear":
            pendingIds.remove(id)
            watchIds.remove(id)
            highAccuracyIds.remove(id)
            watchesToldServicesOff.remove(id)
            stopIfIdle()
        default:
            break
        }
    }

    /// Starts location updates, asking for permission first when the user has not answered yet.
    private func start() {
        guard Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") != nil else {
            ViewController.warnInConsole(
                webView,
                ViewController.undeclaredPermissionMessage(feature: "location", api: "navigator.geolocation")
            )
            failAll(code: 1, message: "The app does not declare the location permission")
            return
        }
        switch manager.authorizationStatus {
        case .notDetermined:
            awaitingAuthorization = true
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            // iOS reports the app as denied while Location Services are off. Asking whether they are on can
            // block, so it is not asked on the main thread.
            DispatchQueue.global(qos: .userInitiated).async {
                let servicesOn = CLLocationManager.locationServicesEnabled()
                DispatchQueue.main.async { self.denied(servicesOn: servicesOn) }
            }
        default:
            manager.desiredAccuracy = highAccuracyIds.isEmpty ? kCLLocationAccuracyHundredMeters : kCLLocationAccuracyBest
            offeringServices = false
            watchesToldServicesOff.removeAll()
            if !updating {
                updating = true
                manager.startUpdatingLocation()
            }
        }
    }

    private func denied(servicesOn: Bool) {
        guard !servicesOn else {
            failAll(code: 1, message: "User denied Geolocation")
            return
        }
        let ids = Array(pendingIds.union(watchIds.subtracting(watchesToldServicesOff)))
        pendingIds.removeAll()
        highAccuracyIds = highAccuracyIds.intersection(watchIds)
        watchesToldServicesOff.formUnion(watchIds)
        if !ids.isEmpty { send("error", ids: ids, arguments: [2, "Location services are off"]) }
        // Starting updates while Location Services are off makes iOS offer to turn them on.
        if !updating && !offeringServices {
            offeringServices = true
            manager.startUpdatingLocation()
        }
    }

    private func stopIfIdle() {
        guard pendingIds.isEmpty, watchIds.isEmpty, updating else { return }
        updating = false
        manager.stopUpdatingLocation()
    }

    /// Continues after the user answered the permission alert, and resumes watches once the app may use
    /// location again (for example after Location Services were turned back on).
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        guard status != .notDetermined else { return }
        let authorized = status == .authorizedWhenInUse || status == .authorizedAlways
        if awaitingAuthorization {
            awaitingAuthorization = false
            if !pendingIds.isEmpty || !watchIds.isEmpty { start() }
        } else if authorized, !watchIds.isEmpty, !updating {
            start()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if offeringServices {
            offeringServices = false
            if !updating { manager.stopUpdatingLocation() }
        }
        guard let location = locations.last else { return }
        let ids = Array(pendingIds.union(watchIds))
        pendingIds.forEach { highAccuracyIds.remove($0) }
        pendingIds.removeAll()
        stopIfIdle()
        guard !ids.isEmpty else { return }

        func value(_ number: Double, valid: Bool) -> Any { valid ? number : NSNull() }
        let position: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "accuracy": location.horizontalAccuracy,
            "altitude": value(location.altitude, valid: location.verticalAccuracy >= 0),
            "altitudeAccuracy": value(location.verticalAccuracy, valid: location.verticalAccuracy >= 0),
            "heading": value(location.course, valid: location.course >= 0 && location.speed > 0),
            "speed": value(location.speed, valid: location.speed >= 0),
            "timestamp": (location.timestamp.timeIntervalSince1970 * 1000).rounded(),
        ]
        send("position", ids: ids, arguments: [position])
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        if code == .locationUnknown { return }
        if offeringServices {
            offeringServices = false
            manager.stopUpdatingLocation()
            if code == .denied { return }
        }
        if code == .denied {
            failAll(code: 1, message: "User denied Geolocation")
        } else {
            failAll(code: 2, message: error.localizedDescription)
        }
    }

    /// Reports an error to every waiting request and watch; a denial also ends the watches.
    private func failAll(code: Int, message: String) {
        let ids = Array(pendingIds.union(watchIds))
        pendingIds.removeAll()
        if code == 1 {
            watchIds.removeAll()
            watchesToldServicesOff.removeAll()
        }
        highAccuracyIds = highAccuracyIds.intersection(watchIds)
        stopIfIdle()
        if !ids.isEmpty { send("error", ids: ids, arguments: [code, message]) }
    }

    private func send(_ function: String, ids: [Int], arguments: [Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: [ids] + arguments),
              let json = String(data: data, encoding: .utf8) else { return }
        let call = "window.__wefterGeolocation && window.__wefterGeolocation.\(function).apply(null, \(json))"
        webView?.evaluateJavaScript(call)
    }
}
