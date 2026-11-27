import UIKit

/// Locks the screen to an orientation while the app runs (a video player in landscape, for example) and
/// returns to the app's own orientation (`orientation` in `wefter.config.json`) on ``unlock()``. Used by the
/// `@wefterjs/screen` plugin.
///
/// `AppDelegate` and the app's screen ask it for the orientations they support, which overrides the
/// `Info.plist` list while the app runs. iPadOS may ignore locks for apps in resizable windows.
public final class OrientationLock {
    public static let shared = OrientationLock()

    /// Orientation names as the Screen Orientation API writes them.
    private static let masks: [String: UIInterfaceOrientationMask] = [
        "portrait": [.portrait, .portraitUpsideDown],
        "portrait-primary": .portrait,
        "portrait-secondary": .portraitUpsideDown,
        "landscape": .landscape,
        "landscape-primary": .landscapeRight,
        "landscape-secondary": .landscapeLeft,
        "any": .all,
    ]

    /// Names ``lock(_:)`` accepts.
    public static var names: Set<String> { Set(masks.keys) }

    private var locked: UIInterfaceOrientationMask?

    private init() {}

    /// The orientations allowed now: the lock, or the app's own from `Info.plist`.
    public var supportedOrientations: UIInterfaceOrientationMask {
        locked ?? Self.appOrientations
    }

    /// Locks the screen to `orientation` (`portrait`, `landscape`, their `-primary`/`-secondary` forms, or
    /// `any`) and rotates to it. Must be called on the main thread.
    ///
    /// - Returns: `false` when `orientation` is unknown.
    @discardableResult
    public func lock(_ orientation: String) -> Bool {
        guard let mask = Self.masks[orientation] else { return false }
        locked = mask
        apply(mask)
        return true
    }

    /// Returns to the app's own orientations. Must be called on the main thread.
    public func unlock() {
        locked = nil
        apply(Self.appOrientations)
    }

    /// Tells the system the supported orientations changed and asks it to rotate into them.
    private func apply(_ mask: UIInterfaceOrientationMask) {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            windowScene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
        }
    }

    /// The orientations `Info.plist` lists for this device.
    private static let appOrientations: UIInterfaceOrientationMask = {
        let isPad = UIDevice.current.userInterfaceIdiom == .pad
        let key = isPad ? "UISupportedInterfaceOrientations~ipad" : "UISupportedInterfaceOrientations"
        let names =
            (Bundle.main.object(forInfoDictionaryKey: key) as? [String])
            ?? (Bundle.main.object(forInfoDictionaryKey: "UISupportedInterfaceOrientations") as? [String])
            ?? []
        var mask: UIInterfaceOrientationMask = []
        for name in names {
            switch name {
            case "UIInterfaceOrientationPortrait": mask.insert(.portrait)
            case "UIInterfaceOrientationPortraitUpsideDown": mask.insert(.portraitUpsideDown)
            case "UIInterfaceOrientationLandscapeLeft": mask.insert(.landscapeLeft)
            case "UIInterfaceOrientationLandscapeRight": mask.insert(.landscapeRight)
            default: break
            }
        }
        return mask.isEmpty ? .all : mask
    }()
}
