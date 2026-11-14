package de.klangniveau.plinth.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID

/** Was nur die Plattform kann (Android: Kiosk verlassen, App beenden …). */
interface Platform {
    val platformName: String
    val version: String
    fun defaultDeviceName(): String
    /** Inhalt der Oberfläche (player/…); null = gibt es nicht */
    fun uiAsset(path: String): InputStream?
    /** Wartung: Kiosk für [minutes] verlassen */
    fun leaveKiosk(minutes: Int) {}
    /** Wartung: Player beenden (bis zum nächsten Neustart des Geräts oder manuellen Start) */
    fun quit() {}
    fun log(level: String, message: String) = println("$level $message")
}

/**
 * Plinth Player – plattformunabhängiger Kern.
 *
 * Netz (Protokoll v1, wie player/src/offline.js, Beschreibung docs/offline.md):
 *   GET  /plinth/v1/info, POST /plinth/v1/koppeln, POST /plinth/v1/pruefen,
 *   PUT  /plinth/v1/medien/<sha256>.<ext>?offset=N, POST /plinth/v1/aktivieren, POST /plinth/v1/einstellungen
 *   UDP 47801: "PLINTH-SUCHE" → Antwort JSON wie /info
 *
 * Nur für das eigene Gerät (127.0.0.1): Oberfläche /app/…, Medien /media/…, Oberflächen-API /app-api/…
 */
class PlayerCore(
    dataDir: File,
    private val platform: Platform,
    private val httpPort: Int = HTTP_PORT,
    private val discoveryPort: Int = DISCOVERY_PORT,
) {
    val store = Store(dataDir)
    val config = DeviceConfig(dataDir)
    private val server = HttpServer(::handle)
    private var udp: DatagramSocket? = null
    private val locks = HashSet<String>()
    private var pairFails = 0
    private var pairLockedUntil = 0L
    private var pinFails = 0
    private var pinLockedUntil = 0L
    private var pinLockMinutes = 5L
    private var unlockedUntil = 0L

    // Zustand für die Oberfläche (Long-Polling über /app-api/poll)
    private val lock = Object()
    private var version = 0L
    private var content: JSONObject? = null
    private val status = JSONObject().put("online", true).put("offline", true).put("blocked", false)
        .put("lastError", JSONObject.NULL).put("download", JSONObject.NULL).put("revision", JSONObject.NULL)
    private var lastProgress = 0L
    @Volatile var lastAlive = System.currentTimeMillis()
        private set

    val port: Int get() = server.port
    val discoveryLocalPort: Int get() = udp?.localPort ?: 0

    fun start() {
        store.playable()?.let { showContent(it) }
        server.start(httpPort)
        startDiscovery()
        log("INFO", "Offline-Empfang bereit auf Port $port, Adressen ${addresses()}")
    }

    fun stop() {
        server.stop()
        udp?.close()
    }

    fun deviceName(): String = config.deviceName ?: platform.defaultDeviceName()

    fun addresses(): List<String> = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .map { it.hostAddress }
    } catch (_: Exception) {
        emptyList()
    }

    fun info(): JSONObject {
        val m = store.manifest(store.state().first)
        val proj = m?.let {
            val p = it.optJSONObject("projekt")
            JSONObject().put("id", p?.optString("id") ?: JSONObject.NULL).put("name", p?.optString("name") ?: JSONObject.NULL).put("revision", it.get("revision"))
        }
        return JSONObject()
            .put("app", "plinth-player").put("protocol", 1).put("version", platform.version)
            .put("deviceId", config.deviceId).put("name", deviceName()).put("platform", platform.platformName)
            .put("port", port).put("paired", config.studios().isNotEmpty())
            .put("projekt", proj ?: JSONObject.NULL)
    }

    // ------------------------------------------------------------ Suche

    private fun startDiscovery() {
        try {
            val s = DatagramSocket(null)
            s.reuseAddress = true
            s.broadcast = true
            s.bind(InetSocketAddress(discoveryPort))
            udp = s
            Thread({
                val buf = ByteArray(512)
                while (!s.isClosed) {
                    try {
                        val p = DatagramPacket(buf, buf.size)
                        s.receive(p)
                        if (String(p.data, 0, p.length, Charsets.UTF_8).trim() != DISCOVERY_MAGIC) continue
                        val reply = info().toString().toByteArray()
                        s.send(DatagramPacket(reply, reply.size, p.address, p.port))
                    } catch (_: Exception) {
                        if (s.isClosed) break
                    }
                }
            }, "plinth-discovery").apply { isDaemon = true }.start()
        } catch (e: Exception) {
            log("WARN", "Suche im Netz nicht verfügbar: ${e.message}")
        }
    }

    // ------------------------------------------------------------ HTTP

    private fun handle(req: Request): Response {
        val p = req.path
        if (req.method == "GET" && p == "/plinth/v1/info") return Response.json(200, info())
        if (req.method == "POST" && p == "/plinth/v1/koppeln") return pair(req)
        if (p.startsWith("/plinth/v1/")) {
            val studio = auth(req) ?: return Response.json(401, errorBody("not_paired", "Nicht gekoppelt. Bitte im Studio mit dem Kopplungscode verbinden."))
            return when {
                req.method == "POST" && p == "/plinth/v1/pruefen" -> check(req)
                req.method == "PUT" && p.startsWith("/plinth/v1/medien/") -> receive(req, p.removePrefix("/plinth/v1/medien/"))
                req.method == "POST" && p == "/plinth/v1/aktivieren" -> activate(req, studio)
                req.method == "POST" && p == "/plinth/v1/einstellungen" -> {
                    applySettings(body(req)); Response.json(200, info())
                }
                else -> Response.json(404, errorBody("not_found", "Unbekannter Pfad"))
            }
        }
        // Alles Weitere nur für das eigene Gerät
        if (!req.isLoopback) return Response.json(403, errorBody("forbidden", "Nur lokal"))
        return when {
            p == "/" || p == "/app" -> Response(302, mapOf("Location" to "/app/"), ByteArray(0))
            p.startsWith("/app/") -> asset(p.removePrefix("/app/").ifEmpty { "index.html" })
            p.startsWith("/media/") -> {
                val name = p.removePrefix("/media/")
                val f = File(store.mediaDir, name)
                if (!Store.NAME.matches(name) || !f.isFile) Response.empty(404) else Response.file(f, Response.mime(name), req.headers["range"])
            }
            p.startsWith("/app-api/") -> appApi(req, p.removePrefix("/app-api/"))
            else -> Response.empty(404)
        }
    }

    private fun body(req: Request): JSONObject = try {
        JSONObject(req.bodyText().ifBlank { "{}" })
    } catch (e: HttpException) {
        throw e
    } catch (_: Exception) {
        JSONObject()
    }

    private fun auth(req: Request): JSONObject? {
        val m = Regex("^Bearer\\s+(\\S+)$").find(req.headers["authorization"] ?: "") ?: return null
        val hash = sha256Hex(m.groupValues[1].toByteArray()).toByteArray()
        return config.studios().firstOrNull { MessageDigest.isEqual(it.getString("tokenHash").toByteArray(), hash) }
    }

    @Synchronized private fun pair(req: Request): Response {
        if (System.currentTimeMillis() < pairLockedUntil) return Response.json(429, errorBody("locked", "Zu viele Fehlversuche. Bitte einige Minuten warten."))
        val b = body(req)
        if (b.optString("code").filter { it.isDigit() } != config.pairCode) {
            if (++pairFails >= 5) {
                pairFails = 0
                pairLockedUntil = System.currentTimeMillis() + 5 * 60_000
                log("WARN", "Kopplung: 5 Fehlversuche, 5 Minuten gesperrt")
            }
            return Response.json(403, errorBody("invalid_code", "Kopplungscode ist falsch."))
        }
        pairFails = 0
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
        val name = b.optString("studio", "Plinth Studio").take(100)
        val id = b.optString("studioId").take(64).ifEmpty { UUID.randomUUID().toString() }
        val studios = config.studios().filter { it.optString("id") != id }.toMutableList()
        studios.add(JSONObject().put("id", id).put("name", name).put("tokenHash", sha256Hex(token.toByteArray())).put("pairedAt", java.time.Instant.now().toString()))
        config.setStudios(studios)
        applySettings(b)
        log("INFO", "Mit Studio gekoppelt: $name")
        changed()
        val out = info()
        out.put("token", token)
        return Response.json(200, out)
    }

    private fun applySettings(b: JSONObject) {
        var any = false
        val name = b.optString("name").trim()
        if (name.isNotEmpty() && b.opt("name") is String) {
            config.deviceName = name.take(100); any = true
        }
        if (b.opt("hideCursor") is Boolean) {
            config.hideCursor = b.getBoolean("hideCursor"); any = true
        }
        val pin = b.opt("pin")
        if (pin is String && Regex("^\\d{4,8}$").matches(pin)) {
            config.setPin(pin); any = true
        }
        if (any) changed()
    }

    private fun partFile(name: String) = File(store.tmpDir, "$name.part")

    private fun check(req: Request): Response {
        val files = body(req).optJSONArray("files")
        if (files == null || (0 until files.length()).any { !Store.validFile(files.opt(it)) }) {
            return Response.json(422, errorBody("invalid", "Ungültige Dateiliste"))
        }
        val missing = JSONArray()
        for (i in 0 until files.length()) {
            val f = files.getJSONObject(i)
            if (store.has(f)) continue
            val part = partFile(f.getString("path").substringAfterLast('/'))
            missing.put(JSONObject().put("path", f.getString("path")).put("offset", minOf(if (part.isFile) part.length() else 0L, f.getLong("size"))))
        }
        return Response.json(200, JSONObject().put("missing", missing))
    }

    private fun receive(req: Request, name: String): Response {
        if (!Store.NAME.matches(name)) return Response.json(422, errorBody("invalid", "Ungültiger Dateiname"))
        val total = req.headers["x-plinth-size"]?.toLongOrNull()
        if (total == null || total < 0) return Response.json(422, errorBody("invalid", "X-Plinth-Size fehlt"))
        val offset = req.query["offset"]?.toLongOrNull() ?: 0L
        val final = File(store.mediaDir, name)
        if (final.isFile && final.length() == total) {
            drain(req.body)
            return Response.json(200, JSONObject().put("offset", total).put("complete", true))
        }
        synchronized(locks) {
            if (!locks.add(name)) {
                drain(req.body)
                return Response.json(409, errorBody("busy", "Datei wird gerade übertragen"))
            }
        }
        try {
            val part = partFile(name)
            var have = if (part.isFile) part.length() else 0L
            if (have > total) {
                part.delete(); have = 0
            }
            if (offset != have) {
                drain(req.body)
                return Response.json(409, errorBody("offset", "Falscher Startpunkt", mapOf("offset" to have)))
            }
            if (req.contentLength > total - offset) {
                return Response.json(422, errorBody("invalid", "Mehr Daten als angekündigt"))
            }
            var n = offset
            try {
                FileOutputStream(part, offset > 0).use { out ->
                    val buf = ByteArray(256 * 1024)
                    while (true) {
                        val r = req.body.read(buf)
                        if (r < 0) break
                        out.write(buf, 0, r)
                        n += r
                        progress(n, total)
                    }
                    out.fd.sync()
                }
            } catch (e: Exception) {
                log("WARN", "Übertragung unterbrochen: $name bei ${part.length()} Bytes (${e.message})")
                return Response.json(400, errorBody("aborted", e.message ?: "abgebrochen", mapOf("offset" to part.length())))
            }
            have = part.length()
            if (have < total) return Response.json(200, JSONObject().put("offset", have).put("complete", false))
            if (sha256File(part) != name.substringBefore('.')) {
                part.delete()
                log("WARN", "Prüfsumme falsch – Datei verworfen: $name")
                return Response.json(422, errorBody("checksum", "Prüfsumme falsch, Datei wird neu übertragen", mapOf("offset" to 0)))
            }
            if (!part.renameTo(final)) throw IllegalStateException("Kann $name nicht ablegen")
            return Response.json(200, JSONObject().put("offset", total).put("complete", true))
        } finally {
            synchronized(locks) { locks.remove(name) }
        }
    }

    private fun drain(input: InputStream) {
        try {
            val buf = ByteArray(64 * 1024)
            while (input.read(buf) >= 0) { /* verwerfen */ }
        } catch (_: Exception) {}
    }

    private fun progress(done: Long, total: Long) {
        val now = System.currentTimeMillis()
        if (now - lastProgress < 500 && done < total) return
        lastProgress = now
        synchronized(lock) {
            status.put("download", JSONObject().put("done", done).put("total", total).put("files", 1))
        }
        changed()
    }

    @Synchronized private fun activate(req: Request, studio: JSONObject): Response {
        val b = body(req)
        val manifest = b.opt("manifest")
        Store.validateManifest(manifest)?.let { return Response.json(422, errorBody("invalid_manifest", it)) }
        manifest as JSONObject
        val files = manifest.getJSONArray("files")
        val missing = JSONArray()
        for (i in 0 until files.length()) if (!store.has(files.getJSONObject(i))) missing.put(files.getJSONObject(i).getString("path"))
        if (missing.length() > 0) {
            return Response.json(409, errorBody("files_missing", "${missing.length()} Datei(en) fehlen noch", mapOf("missing" to missing)))
        }
        val p = b.optJSONObject("projekt")
        val projId = p?.opt("id")?.toString() ?: ""
        val proj = JSONObject().put("id", projId).put("name", (p?.optString("name") ?: "").take(190)).put("studio", studio.optString("name"))
        manifest.put("projekt", proj)
        val key = "offline-" + sha256Hex("${studio.optString("id")}:$projId".toByteArray()).take(12) + "-" + manifest.get("revision")
        store.activate(key, manifest)
        synchronized(lock) {
            status.put("download", JSONObject.NULL).put("revision", manifest.get("revision")).put("lastError", JSONObject.NULL).put("lastCheck", System.currentTimeMillis())
        }
        log("INFO", "Neuer Stand aus dem Studio aktiv: ${proj.optString("name")} Rev. ${manifest.get("revision")}")
        showContent(manifest)
        return Response.json(200, info())
    }

    private fun showContent(m: JSONObject) {
        val files = JSONObject()
        val arr = m.getJSONArray("files")
        for (i in 0 until arr.length()) {
            val f = arr.getJSONObject(i)
            files.put(f.getString("id"), "/media/" + f.getString("path").substringAfterLast('/'))
        }
        synchronized(lock) {
            content = JSONObject().put("revision", m.get("revision")).put("layout", m.getJSONObject("layout")).put("files", files)
            status.put("revision", m.get("revision"))
        }
        changed()
    }

    private fun changed() {
        synchronized(lock) {
            version++
            lock.notifyAll()
        }
    }

    // ------------------------------------------------------------ Oberfläche (nur lokal)

    fun publicState(): JSONObject = JSONObject()
        .put("screen", if (content != null) "player" else "waiting")
        .put("hideCursor", config.hideCursor)
        .put("deviceName", deviceName())
        .put("version", platform.version)
        .put("shortcut", "Menü-Taste der Fernbedienung")
        .put("mode", "offline")
        .put("cloud", false)
        .put("offline", JSONObject().put("code", config.pairCode).put("addresses", JSONArray(addresses())).put("port", port).put("paired", config.studios().isNotEmpty()))

    private fun asset(path: String): Response {
        if (path.contains("..")) return Response.empty(403)
        val input = platform.uiAsset(path) ?: return Response.empty(404)
        val bytes = input.use { it.readBytes() }
        return Response(200, mapOf("Content-Type" to Response.mime(path), "Cache-Control" to "no-cache"), bytes)
    }

    private fun appApi(req: Request, action: String): Response {
        when (action) {
            "poll" -> {
                val since = req.query["v"]?.toLongOrNull() ?: -1
                synchronized(lock) {
                    val until = System.currentTimeMillis() + 25_000
                    while (version == since && System.currentTimeMillis() < until) lock.wait(until - System.currentTimeMillis())
                    return Response.json(200, JSONObject().put("v", version).put("state", publicState())
                        .put("content", content ?: JSONObject.NULL).put("status", JSONObject(status.toString())))
                }
            }
            "alive" -> {
                lastAlive = System.currentTimeMillis()
                return Response.empty(204)
            }
            "error" -> {
                log("ERROR", "Darstellung: ${req.bodyText(4096).take(500)}")
                return Response.empty(204)
            }
            "pin" -> return Response.json(200, JSONObject().put("result", tryPin(body(req).optString("pin"))))
            "action" -> return Response.json(200, maintenanceAction(body(req)))
        }
        return Response.empty(404)
    }

    /** Falsche PIN: nach 5 Fehlversuchen Sperre (5 min, verdoppelt bis 1 h). Ohne PIN vom Studio gilt der Kopplungscode. */
    @Synchronized fun tryPin(pin: String): String {
        val now = System.currentTimeMillis()
        if (now < pinLockedUntil) return "locked"
        val ok = if (config.hasPin()) config.checkPin(pin) else pin == config.pairCode
        if (ok) {
            pinFails = 0
            pinLockMinutes = 5
            unlockedUntil = now + 2 * 60_000
            return "ok"
        }
        log("WARN", "Falsche Wartungs-PIN")
        if (++pinFails >= 5) {
            pinFails = 0
            pinLockedUntil = now + pinLockMinutes * 60_000
            pinLockMinutes = minOf(60, pinLockMinutes * 2)
        }
        return "wrong"
    }

    private fun maintenanceAction(b: JSONObject): JSONObject {
        if (System.currentTimeMillis() > unlockedUntil) return JSONObject().put("ok", false)
        unlockedUntil = System.currentTimeMillis() + 2 * 60_000
        return when (b.optString("action")) {
            "quit" -> {
                log("INFO", "Player per Wartungsmenü beendet")
                platform.quit()
                JSONObject().put("ok", true)
            }
            "timed" -> {
                val min = b.optInt("minutes", 15).coerceIn(1, 240)
                log("INFO", "Wartungsmodus für $min Minuten")
                platform.leaveKiosk(min)
                JSONObject().put("ok", true)
            }
            "cursor" -> {
                config.hideCursor = !config.hideCursor
                changed()
                JSONObject().put("ok", true)
            }
            "sync" -> JSONObject().put("ok", true).put("status", JSONObject(status.toString()))
            "pairing" -> JSONObject().put("ok", true).put("pairing", JSONObject().put("code", config.pairCode).put("addresses", JSONArray(addresses())).put("port", port).put("name", deviceName()))
            "info" -> JSONObject().put("ok", true).put("info", JSONObject()
                .put("version", platform.version).put("deviceName", deviceName()).put("mode", "offline")
                .put("offline", JSONObject().put("code", config.pairCode).put("addresses", JSONArray(addresses())).put("port", port)
                    .put("studios", JSONArray(config.studios().map { it.optString("name") })))
                .put("dataDir", store.dir.absolutePath)
                .put("status", JSONObject(status.toString()))
                .put("revision", content?.opt("revision") ?: JSONObject.NULL)
                .put("log", JSONArray(recentLog())))
            else -> JSONObject().put("ok", false)
        }
    }

    private val logLines = ArrayDeque<String>()

    /** Protokoll: an die Plattform weitergeben und die letzten 40 Zeilen für „Status & Protokoll“ behalten. */
    fun log(level: String, message: String) {
        synchronized(logLines) {
            logLines.addLast("${java.time.Instant.now()} ${level.padEnd(5)} $message")
            while (logLines.size > 40) logLines.removeFirst()
        }
        platform.log(level, message)
    }

    private fun recentLog(): List<String> = synchronized(logLines) { logLines.toList() }

    companion object {
        const val HTTP_PORT = 47800
        const val DISCOVERY_PORT = 47801
        const val DISCOVERY_MAGIC = "PLINTH-SUCHE"

        @Suppress("unused")
        val LOOPBACK: InetAddress = InetAddress.getLoopbackAddress()
    }
}
