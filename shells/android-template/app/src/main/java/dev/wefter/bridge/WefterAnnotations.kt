package dev.wefter.bridge

/**
 * Exposes a plugin function to JavaScript. The function must take
 * `(payload: JSONObject, callback: (Result<Any>) -> Unit)`; `wefter sync` finds it in the source and
 * generates the dispatch code.
 */
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.SOURCE)
annotation class WefterMethod

/** Runs a no-argument plugin function when the lifecycle hook [name] fires, for example `appReady`. */
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.SOURCE)
annotation class WefterHook(val name: String)
