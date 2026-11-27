package dev.wefter.bridge

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

private const val APP = "https://appassets.androidplatform.net"
private const val PARTNER = "https://pay.example.com"
private const val OTHER = "https://ads.example.net"

class BridgeDispatcherTest {

    private lateinit var dispatcher: BridgeDispatcher
    private val replies = mutableListOf<JSONObject>()

    @Before
    fun setUp() {
        val access =
                BridgeAccess(
                        ownOrigins = setOf(APP),
                        grants = mapOf(PARTNER to listOf("biometric.authenticate", "haptics.*"))
                )
        dispatcher = BridgeDispatcher(access, "development", onMain = { it() }, inBackground = { it() })
        replies.clear()
    }

    private fun call(origin: String, plugin: String, method: String, payload: String = "{}") {
        val json = JSONObject().put("callId", "0").put("plugin", plugin).put("method", method).put("payload", payload)
        dispatcher.handleCall(json.toString(), origin) { replies.add(JSONObject(it)) }
    }

    private fun rejectedError(): JSONObject {
        val reply = replies.single()
        assertEquals("reject", reply.getString("type"))
        assertEquals("0", reply.getString("callId"))
        return JSONObject(reply.getString("data"))
    }

    private fun registerEcho(name: String) {
        dispatcher.register(
                name,
                object : NativeModule {
                    override fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit) {
                        callback(Result.success(JSONObject().put("method", method)))
                    }
                }
        )
    }

    @Test
    fun `a call from the app's own page resolves with the module's result as JSON`() {
        registerEcho("device")

        call(APP, "device", "getInfo")

        val reply = replies.single()
        assertEquals("resolve", reply.getString("type"))
        assertEquals("getInfo", JSONObject(reply.getString("data")).getString("method"))
    }

    @Test
    fun `another site cannot call any plugin, even one that exists`() {
        registerEcho("secureStorage")

        call(OTHER, "secureStorage", "get")

        assertEquals("FORBIDDEN_ORIGIN", rejectedError().getString("code"))
    }

    @Test
    fun `a granted site may call exactly the methods it was granted`() {
        registerEcho("biometric")
        registerEcho("haptics")

        call(PARTNER, "biometric", "authenticate")
        assertEquals("resolve", replies.removeAt(0).getString("type"))

        call(PARTNER, "haptics", "vibrate")
        assertEquals("resolve", replies.removeAt(0).getString("type"))

        call(PARTNER, "biometric", "isAvailable")
        assertEquals("FORBIDDEN_ORIGIN", rejectedError().getString("code"))
    }

    @Test
    fun `a granted site never reaches the built-in system module`() {
        registerEcho("__system")

        call(PARTNER, "__system", "openAppSettings")

        assertEquals("FORBIDDEN_ORIGIN", rejectedError().getString("code"))
    }

    @Test
    fun `an unregistered plugin rejects cleanly instead of crashing`() {
        call(APP, "nope", "getInfo")

        val error = rejectedError()
        assertEquals("UNKNOWN_PLUGIN", error.getString("code"))
        assertEquals("No such plugin: nope", error.getString("message"))
    }

    @Test
    fun `a plugin that throws before calling its callback rejects instead of crashing the activity`() {
        dispatcher.register(
                "buggy",
                object : NativeModule {
                    override fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit) {
                        throw IllegalStateException("boom")
                    }
                }
        )

        call(APP, "buggy", "whatever")

        val error = rejectedError()
        assertEquals("PLUGIN_THREW", error.getString("code"))
        assertTrue(error.getString("message").contains("boom"))
    }

    @Test
    fun `a malformed payload rejects instead of throwing`() {
        registerEcho("device")

        call(APP, "device", "getInfo", "not valid json")

        val error = rejectedError()
        assertEquals("INVALID_PAYLOAD", error.getString("code"))
    }

    @Test
    fun `a plugin failing with a WefterError keeps its code`() {
        dispatcher.register(
                "scanner",
                object : NativeModule {
                    override fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit) {
                        callback(Result.failure(WefterError("PERMISSION_DENIED", "Camera permission not granted")))
                    }
                }
        )

        call(APP, "scanner", "open")

        val error = rejectedError()
        assertEquals("PERMISSION_DENIED", error.getString("code"))
        assertEquals("Camera permission not granted", error.getString("message"))
    }

    @Test
    fun `a plugin failing with a plain exception falls back to UNKNOWN`() {
        dispatcher.register(
                "device",
                object : NativeModule {
                    override fun invoke(method: String, payload: JSONObject, callback: (Result<Any>) -> Unit) {
                        callback(Result.failure(Exception("something else broke")))
                    }
                }
        )

        call(APP, "device", "getInfo")

        assertEquals("UNKNOWN", rejectedError().getString("code"))
    }

    @Test
    fun `a message that is not JSON is ignored`() {
        dispatcher.handleCall("not json", APP) { replies.add(JSONObject(it)) }

        assertTrue(replies.isEmpty())
    }

    @Test
    fun `subscribeHook fires every subscriber of that hook and no other`() {
        var paused = 0
        var resumed = false
        dispatcher.subscribeHook("onPause") { paused++ }
        dispatcher.subscribeHook("onPause") { paused++ }
        dispatcher.subscribeHook("onResume") { resumed = true }

        dispatcher.dispatchHook("onPause")

        assertEquals(2, paused)
        assertFalse(resumed)
    }

    @Test
    fun `grants are read from the JSON the CLI writes`() {
        val grants = BridgeAccess.parseGrants("""{"https://pay.example.com":["biometric.authenticate"]}""")

        assertEquals(listOf("biometric.authenticate"), grants["https://pay.example.com"])
        assertTrue(BridgeAccess.parseGrants("").isEmpty())
    }
}
