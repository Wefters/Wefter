import UIKit
import WebKit

/// Back in the app's own pages on iOS, which has no back button: the swipe from the left edge (right edge in
/// right-to-left languages) while `gestures.swipeBack` is `"page"`. The page decides while it listens with
/// `onBack()` from `@wefterjs/core`; otherwise the swipe goes back in the web view's history.
///
/// With `swipeBack` `"history"` WebKit's own interactive swipe goes back instead, and the page isn't asked.
final class BackNavigation: NSObject, UIGestureRecognizerDelegate {
    /// How long the page has to answer before the app does the default.
    private static let pageAnswerTimeout: TimeInterval = 2
    /// How far, in points, or how fast, in points per second, a swipe must go to count.
    private static let minimumDistance: CGFloat = 60
    private static let minimumVelocity: CGFloat = 500

    private weak var webView: WKWebView?
    /// Sends a `__system:back` event to the app's page.
    private let notify: ([String: Any]) -> Void
    private var recognizer: UIScreenEdgePanGestureRecognizer?
    private var listening = false
    private var nextId = 0
    /// The back request the page is answering.
    private var pendingId: Int?
    private var timeout: DispatchWorkItem?

    init(notify: @escaping ([String: Any]) -> Void) {
        self.notify = notify
    }

    /// Goes back in `webView`, created at start or after a content process crash, and follows edge swipes on
    /// `screen`, the view that holds it. The recognizer sits outside the web view, so WebKit doesn't hold it
    /// back while the page handles its own touches (a game's canvas calling `preventDefault()`).
    func attach(to webView: WKWebView, in screen: UIView) {
        self.webView = webView
        guard recognizer == nil else { return }
        let recognizer = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(swiped(_:)))
        recognizer.edges = screen.effectiveUserInterfaceLayoutDirection == .rightToLeft ? .right : .left
        recognizer.delegate = self
        recognizer.isEnabled = false
        recognizer.cancelsTouchesInView = true
        screen.addGestureRecognizer(recognizer)
        self.recognizer = recognizer
    }

    /// Turns the swipe on while `gestures.swipeBack` is `"page"`.
    func setSwipeEnabled(_ enabled: Bool) {
        recognizer?.isEnabled = enabled
    }

    /// `__system.setBackListening`: whether the page has `onBack` listeners. A request the page is still
    /// answering keeps waiting for that answer.
    func setListening(_ value: Bool) {
        listening = value
    }

    /// A new page started loading: it registers its own listeners.
    func onPageStarted() {
        listening = false
        cancelTimeout()
        pendingId = nil
    }

    /// `__system.backResult`: whether the page handled request `id`. A `pending` answer means a listener is
    /// still deciding (a "Quit?" dialog), so the app waits for the final answer instead of timing out.
    func onResult(id: Int, handled: Bool, pending: Bool) {
        guard id == pendingId else { return }
        cancelTimeout()
        if pending { return }
        finishPending(handled: handled)
    }

    @objc private func swiped(_ recognizer: UIScreenEdgePanGestureRecognizer) {
        guard recognizer.state == .ended, let view = recognizer.view else { return }
        let direction: CGFloat = recognizer.edges == .right ? -1 : 1
        let distance = recognizer.translation(in: view).x * direction
        let velocity = recognizer.velocity(in: view).x * direction
        guard distance > Self.minimumDistance || velocity > Self.minimumVelocity else { return }
        onBack(edge: recognizer.edges == .right ? "right" : "left")
    }

    private func onBack(edge: String) {
        guard listening else {
            defaultBack()
            return
        }
        finishPending(handled: true)
        nextId += 1
        let id = nextId
        pendingId = id
        notify(["id": id, "source": "gesture", "edge": edge, "canGoBack": webView?.canGoBack ?? false])
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.pendingId == id else { return }
            self.finishPending(handled: false)
        }
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.pageAnswerTimeout, execute: work)
    }

    /// Ends the request the page was answering, doing the default when it wasn't handled.
    private func finishPending(handled: Bool) {
        guard pendingId != nil else { return }
        pendingId = nil
        cancelTimeout()
        if !handled { defaultBack() }
    }

    private func cancelTimeout() {
        timeout?.cancel()
        timeout = nil
    }

    /// Goes back in the web view's history. iOS apps don't close themselves.
    private func defaultBack() {
        if webView?.canGoBack == true { webView?.goBack() }
    }

    /// Lets the page keep its own touches while the swipe is being recognised.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}
