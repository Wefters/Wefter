import UIKit

/// Opens links the web view does not load itself in the app that handles them: web pages in Safari, and
/// `tel:`, `mailto:`, `sms:`, `maps:` and other app links in their apps.
enum ExternalLinks {
    /// Schemes that must never be handed to another app.
    private static let blockedSchemes: Set<String> = ["javascript", "file", "about", "data", "blob", AssetSchemeHandler.scheme]

    /// Opens `url` outside the app. A link no app can open shows a short message over `viewController`;
    /// blocked schemes are ignored.
    static func open(_ url: URL, from viewController: UIViewController?) {
        guard let scheme = url.scheme?.lowercased(), !blockedSchemes.contains(scheme) else { return }
        UIApplication.shared.open(url, options: [:]) { [weak viewController] opened in
            guard !opened, let viewController else { return }
            let alert = UIAlertController(title: nil, message: WefterText.get("links.noApp"), preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: WefterText.get("dialog.ok"), style: .default))
            viewController.presentOnTop(alert)
        }
    }
}

extension UIViewController {
    /// The view controller shown on top of this one, where new alerts and sheets must be presented.
    var topPresentedViewController: UIViewController {
        var top: UIViewController = self
        while let presented = top.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }

    /// Presents `viewController` over whatever is on screen.
    ///
    /// - Returns: Whether it could be presented (the app is on screen).
    @discardableResult
    func presentOnTop(_ viewController: UIViewController) -> Bool {
        let top = topPresentedViewController
        guard top.viewIfLoaded?.window != nil else { return false }
        top.present(viewController, animated: true)
        return true
    }
}
