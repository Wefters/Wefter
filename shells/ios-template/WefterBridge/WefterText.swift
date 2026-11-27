import Foundation

/// Text the shell and plugins show to users, in the user's language.
///
/// `wefter sync` writes `Resources/WefterMessages.json` from the shell's and plugins' `i18n/<language>.json`
/// files and `localization.messages` in `wefter.config.json`, for the languages the app lists in
/// `localization.languages` (English always). A text is looked up in the first of the user's languages the
/// app has, then in English, then the key itself is shown.
public enum WefterText {
    private static let fallback = "en"

    private static let messages: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "WefterMessages", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: [String: String]]
        else { return [:] }
        return json
    }()

    /// The language the app's text is shown in: the first of the user's languages the app has.
    public static let language: String = {
        let available = Array(messages.keys)
        guard !available.isEmpty else { return fallback }
        return Bundle.preferredLocalizations(from: available, forPreferences: Locale.preferredLanguages).first
            ?? fallback
    }()

    /// The text for `key`, with each `{name}` in it replaced by `values["name"]`.
    ///
    ///     WefterText.get("downloads.saved", ["name": "report.pdf"])
    public static func get(_ key: String, _ values: [String: Any] = [:]) -> String {
        let text = messages[language]?[key] ?? messages[fallback]?[key] ?? key
        return values.reduce(text) { result, entry in
            result.replacingOccurrences(of: "{\(entry.key)}", with: "\(entry.value)")
        }
    }
}
