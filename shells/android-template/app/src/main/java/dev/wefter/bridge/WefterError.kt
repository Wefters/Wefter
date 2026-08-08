package dev.wefter.bridge

class WefterError(val code: String, message: String) : Exception(message)
