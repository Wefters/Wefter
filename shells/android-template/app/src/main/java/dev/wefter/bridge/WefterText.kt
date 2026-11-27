package dev.wefter.bridge

import android.content.Context
import android.os.Build
import java.util.Locale
import org.json.JSONObject

/**
 * Text the shell and plugins show to users, in the user's language.
 *
 * `wefter sync` writes `assets/wefter-messages.json` from the shell's and plugins' `i18n/<language>.json`
 * files and `localization.messages` in `wefter.config.json`, for the languages the app lists in
 * `localization.languages` (English always). A text is looked up in the first of the user's languages the
 * app has, then in English, then the key itself is shown.
 */
object WefterText {
    private const val FILE = "wefter-messages.json"
    private const val FALLBACK = "en"

    @Volatile private var messages: Map<String, Map<String, String>>? = null

    /**
     * The text for [key], with each `{name}` in it replaced by `values["name"]`.
     *
     * @example WefterText.get(context, "downloads.saved", mapOf("name" to "report.pdf"))
     */
    fun get(context: Context, key: String, values: Map<String, Any?> = emptyMap()): String {
        val all = load(context)
        val text =
                languages(context).firstNotNullOfOrNull { all[it]?.get(key) }
                        ?: all[FALLBACK]?.get(key)
                        ?: key
        return values.entries.fold(text) { result, (name, value) -> result.replace("{$name}", value.toString()) }
    }

    /** The language the app's text is shown in: the first of the user's languages the app has. */
    fun language(context: Context): String = languages(context).firstOrNull { it in load(context) } ?: FALLBACK

    /** The user's languages, most preferred first, each as `language-Region` and then `language`. */
    private fun languages(context: Context): List<String> {
        val locales =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    val list = context.resources.configuration.locales
                    (0 until list.size()).map { list[it] }
                } else {
                    @Suppress("DEPRECATION") listOf(context.resources.configuration.locale)
                }
        return locales.flatMap { candidates(it) }.distinct()
    }

    private fun candidates(locale: Locale): List<String> {
        val script = locale.script.takeIf { it.isNotEmpty() }
        val region = locale.country.takeIf { it.isNotEmpty() }
        return listOfNotNull(
                script?.let { "${locale.language}-$it" },
                region?.let { "${locale.language}-$it" },
                locale.language
        )
    }

    private fun load(context: Context): Map<String, Map<String, String>> {
        messages?.let { return it }
        val loaded =
                try {
                    val json = context.assets.open(FILE).bufferedReader().use { it.readText() }
                    val root = JSONObject(json)
                    root.keys().asSequence().associateWith { language ->
                        val texts = root.getJSONObject(language)
                        texts.keys().asSequence().associateWith { texts.getString(it) }
                    }
                } catch (_: Exception) {
                    emptyMap()
                }
        messages = loaded
        return loaded
    }
}
