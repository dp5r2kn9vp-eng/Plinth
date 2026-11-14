package de.klangniveau.plinth.core

import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CoreTest {
    private fun tmp(): File = Files.createTempDirectory("plinth-core").toFile()
    private val sha = "a".repeat(64)

    @Test fun `Dateieintraege werden streng geprueft`() {
        assertTrue(Store.validFile(JSONObject().put("path", "media/$sha.mp4").put("size", 10).put("sha256", sha)))
        assertFalse(Store.validFile(JSONObject().put("path", "../$sha.mp4").put("size", 10).put("sha256", sha)))
        assertFalse(Store.validFile(JSONObject().put("path", "media/$sha.mp4").put("size", -1).put("sha256", sha)))
        assertFalse(Store.validFile(JSONObject().put("path", "media/${"b".repeat(64)}.mp4").put("size", 1).put("sha256", sha)))
        assertFalse(Store.validFile(JSONObject().put("path", "media/$sha.mp4").put("size", 1.5).put("sha256", sha)))
    }

    @Test fun `Manifest-Pruefung wie beim Windows-Player`() {
        assertNotNull(Store.validateManifest(JSONObject().put("schemaVersion", 2)))
        assertNull(Store.validateManifest(JSONObject().put("schemaVersion", 1).put("revision", 1).put("layout", JSONObject()).put("files", org.json.JSONArray())))
    }

    @Test fun `Konfiguration erzeugt Identitaet und prueft die PIN`() {
        val dir = tmp()
        val c = DeviceConfig(dir)
        assertTrue(Regex("^\\d{6}$").matches(c.pairCode))
        assertFalse(c.hasPin())
        c.setPin("4711")
        assertTrue(c.checkPin("4711"))
        assertFalse(c.checkPin("1174"))
        val again = DeviceConfig(dir)
        assertEquals(c.deviceId, again.deviceId, "Identität bleibt nach Neustart")
        assertEquals(c.pairCode, again.pairCode)
        assertTrue(again.checkPin("4711"))
        assertFalse(again.raw().contains("4711"))
    }

    @Test fun `Umschalten behaelt den vorigen Stand und raeumt auf`() {
        val s = Store(tmp())
        fun put(content: String): JSONObject {
            val bytes = content.toByteArray()
            val h = sha256Hex(bytes)
            File(s.mediaDir, "$h.png").writeBytes(bytes)
            return JSONObject().put("id", "f1").put("path", "media/$h.png").put("size", bytes.size).put("sha256", h)
        }
        fun manifest(rev: Int, f: JSONObject) = JSONObject().put("schemaVersion", 1).put("revision", rev).put("layout", JSONObject()).put("files", org.json.JSONArray().put(f))
        val a = put("eins")
        s.activate("p-1", manifest(1, a))
        val b = put("zwei")
        s.activate("p-2", manifest(2, b))
        assertEquals("p-2" to "p-1", s.state())
        val c = put("drei")
        s.activate("p-3", manifest(3, c))
        assertFalse(File(s.mediaDir, a.getString("path").substringAfter('/')).exists(), "Datei von Rev. 1 aufgeräumt")
        assertEquals(3, s.playable()!!.getInt("revision"))
        File(s.mediaDir, c.getString("path").substringAfter('/')).delete()
        assertEquals(2, s.playable()!!.getInt("revision"), "Rückfall auf den vorigen Stand")
    }

    @Test fun `PIN-Sperre nach fuenf Fehlversuchen, ohne Studio-PIN gilt der Kopplungscode`() {
        val p = object : Platform {
            override val platformName = "test"
            override val version = "0"
            override fun defaultDeviceName() = "Test"
            override fun uiAsset(path: String) = null
            override fun log(level: String, message: String) {}
        }
        val core = PlayerCore(tmp(), p, 0, 0)
        assertEquals("ok", core.tryPin(core.config.pairCode))
        repeat(5) { assertEquals("wrong", core.tryPin("x")) }
        assertEquals("locked", core.tryPin(core.config.pairCode))
    }
}
