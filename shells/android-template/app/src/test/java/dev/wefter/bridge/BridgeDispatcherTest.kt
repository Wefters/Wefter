package dev.wefter.bridge

import android.webkit.WebView
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock

class BridgeDispatcherTest {

    private lateinit var webView: WebView
    private lateinit var dispatcher: BridgeDispatcher
    private val evaluatedJs = mutableListOf<String>()

    @Before
    fun setUp() {
        webView = mock(WebView::class.java)
        doAnswer { invocation ->
                    (invocation.arguments[0] as Runnable).run()
                    true
                }
                .`when`(webView)
                .post(org.mockito.ArgumentMatchers.any())
        doAnswer { invocation ->
                    evaluatedJs.add(invocation.arguments[0] as String)
                    null
                }
                .`when`(webView)
                .evaluateJavascript(
                        org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.any()
                )

        dispatcher = BridgeDispatcher(webView)
        evaluatedJs.clear()
    }

    private fun parseRejectedError(js: String): JSONObject {
        val quotedArg = js.substringAfter("reject('0', ").removeSuffix(")")
        return JSONObject(org.json.JSONTokener(quotedArg).nextValue() as String)
    }

    @Test
    fun `invoke resolves with a properly quoted JSON string, not a raw object literal`() {
        dispatcher.register(
                "device",
                object : NativeModule {
                    override fun invoke(
                            method: String,
                            payload: JSONObject,
                            callback: (Result<Any>) -> Unit
                    ) {
                        callback(Result.success(JSONObject().put("platform", "android")))
                    }
                }
        )

        dispatcher.invoke("0", "device", "getInfo", "{}")

        val js = evaluatedJs.single()
        assertTrue(js.contains("resolve('0', \""))
        val quotedArg = js.substringAfter("resolve('0', ").removeSuffix(")")
        val parsed = JSONObject(org.json.JSONTokener(quotedArg).nextValue() as String)
        assertEquals("android", parsed.getString("platform"))
    }

    @Test
    fun `invoke on an unregistered plugin rejects cleanly instead of crashing`() {
        dispatcher.invoke("0", "nope", "getInfo", "{}")

        val js = evaluatedJs.single()
        assertTrue(js.contains("window.__wefterNative.reject('0'"))
        val error = parseRejectedError(js)
        assertEquals("UNKNOWN_PLUGIN", error.getString("code"))
        assertEquals("No such plugin: nope", error.getString("message"))
    }

    @Test
    fun `a plugin that throws synchronously before calling its callback rejects instead of crashing the Activity`() {
        dispatcher.register(
                "buggy",
                object : NativeModule {
                    override fun invoke(
                            method: String,
                            payload: JSONObject,
                            callback: (Result<Any>) -> Unit
                    ) {
                        throw IllegalStateException("boom")
                    }
                }
        )

        dispatcher.invoke("0", "buggy", "whatever", "{}")

        val js = evaluatedJs.single()
        assertTrue(js.contains("window.__wefterNative.reject('0'"))
        val error = parseRejectedError(js)
        assertEquals("PLUGIN_THREW", error.getString("code"))
        assertTrue(error.getString("message").contains("Plugin threw"))
        assertTrue(error.getString("message").contains("boom"))
    }

    @Test
    fun `invoke with malformed JSON payload rejects instead of throwing`() {
        dispatcher.register(
                "device",
                object : NativeModule {
                    override fun invoke(
                            method: String,
                            payload: JSONObject,
                            callback: (Result<Any>) -> Unit
                    ) {
                        callback(Result.success(JSONObject()))
                    }
                }
        )

        dispatcher.invoke("0", "device", "getInfo", "not valid json")

        val js = evaluatedJs.single()
        assertTrue(js.contains("window.__wefterNative.reject('0'"))
        val error = parseRejectedError(js)
        assertEquals("INVALID_PAYLOAD", error.getString("code"))
        assertTrue(error.getString("message").contains("Invalid payload"))
    }

    @Test
    fun `getEnvironment returns the build's flavor name synchronously, no bridge round trip`() {
        assertEquals(BuildConfig.FLAVOR, dispatcher.getEnvironment())
        assertTrue(evaluatedJs.isEmpty())
    }

    @Test
    fun `a plugin failing with a WefterError propagates its real code instead of the generic UNKNOWN fallback`() {
        dispatcher.register(
                "scanner",
                object : NativeModule {
                    override fun invoke(
                            method: String,
                            payload: JSONObject,
                            callback: (Result<Any>) -> Unit
                    ) {
                        callback(Result.failure(WefterError("PERMISSION_DENIED", "Camera permission not granted")))
                    }
                }
        )

        dispatcher.invoke("0", "scanner", "open", "{}")

        val js = evaluatedJs.single()
        val error = parseRejectedError(js)
        assertEquals("PERMISSION_DENIED", error.getString("code"))
        assertEquals("Camera permission not granted", error.getString("message"))
    }

    @Test
    fun `a plugin failing with a plain exception (not WefterError) still falls back to UNKNOWN`() {
        dispatcher.register(
                "device",
                object : NativeModule {
                    override fun invoke(
                            method: String,
                            payload: JSONObject,
                            callback: (Result<Any>) -> Unit
                    ) {
                        callback(Result.failure(Exception("something else broke")))
                    }
                }
        )

        dispatcher.invoke("0", "device", "getInfo", "{}")

        val error = parseRejectedError(evaluatedJs.single())
        assertEquals("UNKNOWN", error.getString("code"))
        assertEquals("something else broke", error.getString("message"))
    }

    @Test
    fun `subscribeHook fires every subscriber registered under the same hook name`() {
        var firstFired = false
        var secondFired = false
        dispatcher.subscribeHook("onPause") { firstFired = true }
        dispatcher.subscribeHook("onPause") { secondFired = true }

        dispatcher.dispatchHook("onPause")

        assertTrue(firstFired)
        assertTrue(secondFired)
    }

    @Test
    fun `dispatchHook does not fire subscribers registered under a different hook name`() {
        var paused = false
        var resumed = false
        dispatcher.subscribeHook("onPause") { paused = true }
        dispatcher.subscribeHook("onResume") { resumed = true }

        dispatcher.dispatchHook("onPause")

        assertTrue(paused)
        assertTrue(!resumed)
    }

    @Test
    fun `dispatchHook with no subscribers is a harmless no-op`() {
        dispatcher.dispatchHook("onPause")
    }
}
