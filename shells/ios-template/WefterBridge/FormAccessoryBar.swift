import ObjectiveC
import UIKit
import WebKit

/// Removes the bar iOS shows above the keyboard in web forms (previous, next and Done), which native apps do
/// not have. `keyboard.accessoryBar` in `wefter.config.json` keeps it.
///
/// WebKit has no setting for this, so the web view's content view is given a subclass whose
/// `inputAccessoryView` is `nil`: only that web view changes, and nothing is swizzled globally.
enum FormAccessoryBar {
    private static let subclassName = "WefterContentViewWithoutAccessoryBar"

    /// Hides the bar in `webView`. Does nothing when the bar is enabled or the content view is not found.
    static func apply(to webView: WKWebView) {
        guard !BuildConfig.formAccessoryBar else { return }
        guard
            let contentView = webView.scrollView.subviews.first(where: {
                NSStringFromClass(type(of: $0)).hasPrefix("WKContent")
            }),
            let subclass = subclassWithoutAccessoryBar(of: type(of: contentView))
        else { return }
        object_setClass(contentView, subclass)
    }

    /// The subclass of `base` whose `inputAccessoryView` is `nil`, created on first use.
    private static func subclassWithoutAccessoryBar(of base: AnyClass) -> AnyClass? {
        if let existing = NSClassFromString(subclassName) { return existing }
        guard
            let subclass = objc_allocateClassPair(base, subclassName, 0),
            let original = class_getInstanceMethod(base, #selector(getter: UIResponder.inputAccessoryView))
        else { return nil }

        let noAccessoryView: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
        class_addMethod(
            subclass,
            #selector(getter: UIResponder.inputAccessoryView),
            imp_implementationWithBlock(noAccessoryView),
            method_getTypeEncoding(original)
        )
        objc_registerClassPair(subclass)
        return subclass
    }
}
