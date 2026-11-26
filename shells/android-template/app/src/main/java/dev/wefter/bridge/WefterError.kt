package dev.wefter.bridge

/**
 * An error a plugin returns to JavaScript. [code] (such as `PERMISSION_DENIED`) becomes the
 * `WefterBridgeError` code there.
 */
class WefterError(val code: String, message: String) : Exception(message)
