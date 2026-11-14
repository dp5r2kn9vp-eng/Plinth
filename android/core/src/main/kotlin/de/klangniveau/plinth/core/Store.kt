package de.klangniveau.plinth.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/** Schreibt atomar: erst temporär (mit fsync), dann umbenennen. Ein Stromausfall hinterlässt nie eine halbe Datei. */
fun writeAtomic(file: File, text: String) {
    file.parentFile?.mkdirs()
    val tmp = File(file.parentFile, "${file.name}.tmp")
    FileOutputStream(tmp).use { out ->
        out.write(text.toByteArray(Charsets.UTF_8))
        out.fd.sync()
    }
    if (!tmp.renameTo(file)) {
        file.delete()
        if (!tmp.renameTo(file)) throw IllegalStateException("Kann ${file.name} nicht schreiben")
    }
}

fun readJson(file: File): JSONObject? = try {
    JSONObject(file.readText(Charsets.UTF_8).removePrefix("﻿"))
} catch (_: Exception) {
    null
}

fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

fun sha256File(f: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    f.inputStream().use { input ->
        val buf = ByteArray(1024 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            md.update(buf, 0, n)
        }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
}

/**
 * Ablage der Inhalte – gleiche Struktur wie der Windows-Player (player/src/sync.js):
 * media/<sha256>.<ext>, manifests/<schlüssel>.json, state.json {current, previous}, tmp/ für angefangene Übertragungen.
 */
class Store(val dir: File) {
    val mediaDir = File(dir, "media")
    val tmpDir = File(dir, "tmp")
    val manifestDir = File(dir, "manifests")
    private val stateFile = File(dir, "state.json")

    init {
        for (d in listOf(mediaDir, tmpDir, manifestDir)) d.mkdirs()
    }

    fun state(): Pair<String?, String?> {
        val o = readJson(stateFile) ?: return null to null
        return o.optString("current").ifEmpty { null }.takeUnless { o.isNull("current") } to
            o.optString("previous").ifEmpty { null }.takeUnless { o.isNull("previous") }
    }

    fun manifest(key: String?): JSONObject? = key?.let { readJson(File(manifestDir, "$it.json")) }

    fun localFile(path: String) = File(mediaDir, path.substringAfterLast('/'))

    fun has(file: JSONObject): Boolean {
        val f = localFile(file.getString("path"))
        return f.isFile && f.length() == file.getLong("size")
    }

    fun complete(m: JSONObject?): Boolean {
        if (m == null) return false
        val files = m.optJSONArray("files") ?: return false
        return (0 until files.length()).all { has(files.getJSONObject(it)) }
    }

    /** Aktuell anzeigbarer Stand: aktueller, sonst Rückfall auf den vorigen. */
    fun playable(): JSONObject? {
        val (cur, prev) = state()
        for (key in listOf(cur, prev)) {
            val m = manifest(key)
            if (complete(m)) return m
        }
        return null
    }

    fun activate(key: String, manifest: JSONObject) {
        writeAtomic(File(manifestDir, "$key.json"), manifest.toString())
        val (cur, prev) = state()
        val o = JSONObject().put("current", key).put("previous", if (cur != key) cur ?: JSONObject.NULL else prev ?: JSONObject.NULL)
        writeAtomic(stateFile, o.toString())
        cleanup()
        tmpDir.listFiles()?.forEach { it.delete() }
    }

    /** Entfernt Dateien, die weder der aktuelle noch der vorige Stand braucht. */
    fun cleanup() {
        val (cur, prev) = state()
        val keys = listOfNotNull(cur, prev).toSet()
        val keep = HashSet<String>()
        for (k in keys) {
            val files = manifest(k)?.optJSONArray("files") ?: continue
            for (i in 0 until files.length()) keep.add(files.getJSONObject(i).getString("path").substringAfterLast('/'))
        }
        mediaDir.listFiles()?.forEach { if (it.name !in keep) it.delete() }
        manifestDir.listFiles()?.forEach { if (it.name.removeSuffix(".json") !in keys) it.delete() }
    }

    companion object {
        val NAME = Regex("^[a-f0-9]{64}\\.[a-z0-9]{1,8}$")
        private val SHA = Regex("^[a-f0-9]{64}$")

        fun validFile(f: Any?): Boolean {
            if (f !is JSONObject) return false
            val p = f.optString("path")
            val name = p.substringAfterLast('/')
            val sha = f.optString("sha256")
            val size = f.opt("size")
            return NAME.matches(name) && p == "media/$name" && SHA.matches(sha) && name.startsWith(sha) &&
                size is Number && size.toLong() >= 0 && size.toDouble() == size.toLong().toDouble()
        }

        /** Gleiche Prüfung wie SyncEngine.validate (Windows-Player). */
        fun validateManifest(m: Any?): String? {
            if (m !is JSONObject) return "Manifest fehlt"
            if (m.optInt("schemaVersion", -1) != 1 || m.optJSONArray("files") == null || m.optJSONObject("layout") == null) {
                return "Manifest hat ein unbekanntes Format"
            }
            if (m.opt("revision") !is Number) return "Revision fehlt"
            val files = m.getJSONArray("files")
            for (i in 0 until files.length()) if (!validFile(files.opt(i))) return "Ungültiger Dateieintrag"
            return null
        }
    }
}

/** Gerätekonfiguration in config.json: Identität, Kopplungen (nur Token-Hash), Wartungs-PIN (PBKDF2). */
class DeviceConfig(dir: File) {
    private val file = File(dir, "config.json")
    private val data: JSONObject = readJson(file) ?: JSONObject()

    init {
        var changed = false
        if (data.optString("deviceId").isEmpty()) {
            data.put("deviceId", UUID.randomUUID().toString()); changed = true
        }
        if (!Regex("^\\d{6}$").matches(data.optString("pairCode"))) {
            data.put("pairCode", "%06d".format(SecureRandom().nextInt(1_000_000))); changed = true
        }
        if (data.optJSONArray("studios") == null) {
            data.put("studios", JSONArray()); changed = true
        }
        if (!data.has("hideCursor")) {
            data.put("hideCursor", true); changed = true
        }
        if (changed) save()
    }

    @Synchronized fun save() = writeAtomic(file, data.toString(2))

    val deviceId: String get() = data.getString("deviceId")
    val pairCode: String get() = data.getString("pairCode")
    var deviceName: String?
        @Synchronized get() = data.optString("deviceName").ifEmpty { null }
        @Synchronized set(v) { data.put("deviceName", v ?: JSONObject.NULL); save() }
    var hideCursor: Boolean
        @Synchronized get() = data.optBoolean("hideCursor", true)
        @Synchronized set(v) { data.put("hideCursor", v); save() }

    @Synchronized fun studios(): List<JSONObject> {
        val a = data.getJSONArray("studios")
        return (0 until a.length()).map { a.getJSONObject(it) }
    }

    @Synchronized fun setStudios(list: List<JSONObject>) {
        data.put("studios", JSONArray(list)); save()
    }

    @Synchronized fun hasPin() = data.optJSONObject("pin") != null

    @Synchronized fun setPin(pin: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        data.put("pin", JSONObject().put("salt", hex(salt)).put("hash", hex(pbkdf2(pin, salt))).put("iter", ITER))
        save()
    }

    @Synchronized fun checkPin(pin: String): Boolean {
        val p = data.optJSONObject("pin") ?: return false
        val expected = unhex(p.getString("hash"))
        val actual = pbkdf2(pin, unhex(p.getString("salt")), p.optInt("iter", ITER))
        return MessageDigest.isEqual(expected, actual)
    }

    /** Für Tests und Anzeige */
    @Synchronized fun raw(): String = data.toString()

    companion object {
        private const val ITER = 120_000
        private fun pbkdf2(pin: String, salt: ByteArray, iter: Int = ITER): ByteArray =
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pin.toCharArray(), salt, iter, 256)).encoded
        private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
        private fun unhex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
}
