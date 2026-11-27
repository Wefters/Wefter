import AVFoundation
import CoreLocation
import Photos
import UIKit
import UserNotifications

/// Where a permission stands, as plugins report it to JavaScript (`checkPermissions()`):
///
/// - `granted`: the app may use it.
/// - `prompt`: asking shows the system prompt.
/// - `denied`: only the Settings app can change it.
/// - `limited`: partly granted, such as the photos the user picked.
public enum PermissionState: String {
    case granted
    case prompt
    case denied
    case limited

    /// Camera or microphone access.
    public init(_ status: AVAuthorizationStatus) {
        switch status {
        case .authorized: self = .granted
        case .notDetermined: self = .prompt
        default: self = .denied
        }
    }

    /// Location access. "When in use" counts as granted.
    public init(_ status: CLAuthorizationStatus) {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: self = .granted
        case .notDetermined: self = .prompt
        default: self = .denied
        }
    }

    /// Photo library access.
    public init(_ status: PHAuthorizationStatus) {
        switch status {
        case .authorized: self = .granted
        case .limited: self = .limited
        case .notDetermined: self = .prompt
        default: self = .denied
        }
    }

    /// Notification access. Provisional and ephemeral authorisation count as granted.
    public init(_ status: UNAuthorizationStatus) {
        switch status {
        case .authorized, .provisional, .ephemeral: self = .granted
        case .notDetermined: self = .prompt
        default: self = .denied
        }
    }
}

/// Shared permission helpers for the shell and plugins.
public enum Permissions {
    /// Opens this app's page in the Settings app, where the user can change its permissions.
    public static func openAppSettings() {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        }
    }

    /// Whether the app's `Info.plist` has `key`, the usage description iOS requires before asking.
    public static func hasUsageDescription(_ key: String) -> Bool {
        Bundle.main.object(forInfoDictionaryKey: key) != nil
    }
}
