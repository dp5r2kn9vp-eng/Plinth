package de.klangniveau.plinth.core

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URLDecoder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Kleiner HTTP/1.1-Server ohne Fremdbibliotheken (Android und JVM).
 * Jede Verbindung wird nach der Antwort geschlossen; Anfragekörper nur mit Content-Length.
 */
class HttpServer(private val handler: (Request) -> Response) {
    private var socket: ServerSocket? = null
    private var pool: ExecutorService? = null

    val port: Int get() = socket?.localPort ?: 0

    fun start(port: Int, bind: InetAddress? = null) {
        val s = ServerSocket()
        s.reuseAddress = true
        s.bind(InetSocketAddress(bind, port))
        socket = s
        val p = Executors.newCachedThreadPool { r -> Thread(r, "plinth-http").apply { isDaemon = true } }
        pool = p
        Thread({
            while (!s.isClosed) {
                val client = try { s.accept() } catch (_: SocketException) { break }
                p.execute { serve(client) }
            }
        }, "plinth-http-accept").apply { isDaemon = true }.start()
    }

    fun stop() {
        try { socket?.close() } catch (_: Exception) {}
        pool?.shutdownNow()
        socket = null
    }

    private fun serve(client: Socket) {
        client.use { c ->
            c.soTimeout = 120_000
            val input = BufferedInputStream(c.getInputStream(), 64 * 1024)
            val out = c.getOutputStream()
            val req = try {
                parse(input, c.inetAddress)
            } catch (e: Exception) {
                null
            } ?: return
            val res = try {
                handler(req)
            } catch (e: HttpException) {
                Response.json(e.status, e.body)
            } catch (e: Exception) {
                Response.json(500, errorBody("internal", e.message ?: e.toString()))
            }
            try {
                res.write(out, req.method == "HEAD")
            } catch (_: Exception) {
                // Verbindung vom Gegenüber geschlossen
            }
        }
    }

    private fun parse(input: InputStream, remote: InetAddress): Request? {
        val head = readHead(input) ?: return null
        val lines = head.split("\r\n")
        val parts = lines[0].split(" ")
        if (parts.size < 3) return null
        val headers = HashMap<String, String>()
        for (line in lines.drop(1)) {
            val i = line.indexOf(':')
            if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
        }
        val target = parts[1]
        val q = target.indexOf('?')
        val rawPath = if (q >= 0) target.substring(0, q) else target
        val query = HashMap<String, String>()
        if (q >= 0) {
            for (kv in target.substring(q + 1).split('&')) {
                if (kv.isEmpty()) continue
                val e = kv.indexOf('=')
                if (e < 0) query[decode(kv)] = "" else query[decode(kv.substring(0, e))] = decode(kv.substring(e + 1))
            }
        }
        val length = headers["content-length"]?.toLongOrNull() ?: 0L
        if (headers["transfer-encoding"]?.lowercase()?.contains("chunked") == true) {
            throw HttpException(411, errorBody("length_required", "Content-Length erforderlich"))
        }
        return Request(parts[0].uppercase(), decode(rawPath), query, headers, LimitedInputStream(input, length), length, remote)
    }

    /** Liest bis \r\n\r\n (max. 32 KB). */
    private fun readHead(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        var state = 0
        while (true) {
            val b = input.read()
            if (b < 0) return null
            buf.write(b)
            state = when {
                b == '\r'.code && (state == 0 || state == 2) -> state + 1
                b == '\n'.code && (state == 1 || state == 3) -> state + 1
                else -> 0
            }
            if (state == 4) break
            if (buf.size() > 32 * 1024) return null
        }
        return buf.toString(Charsets.ISO_8859_1.name()).removeSuffix("\r\n\r\n")
    }

    private fun decode(s: String) = try { URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") } catch (_: Exception) { s }
}

class Request(
    val method: String,
    val path: String,
    val query: Map<String, String>,
    val headers: Map<String, String>,
    val body: InputStream,
    val contentLength: Long,
    val remote: InetAddress,
) {
    val isLoopback: Boolean get() = remote.isLoopbackAddress

    fun bodyText(max: Int = 16 * 1024 * 1024): String {
        if (contentLength > max) throw HttpException(413, errorBody("too_large", "Anfrage zu groß"))
        return body.readBytes().toString(Charsets.UTF_8)
    }
}

class HttpException(val status: Int, val body: String) : Exception(body)

fun errorBody(code: String, message: String, extra: Map<String, Any?> = emptyMap()): String {
    val o = org.json.JSONObject()
    o.put("error", org.json.JSONObject().put("code", code).put("message", message))
    for ((k, v) in extra) o.put(k, v)
    return o.toString()
}

class Response(
    val status: Int,
    val headers: Map<String, String>,
    private val bytes: ByteArray? = null,
    private val file: File? = null,
    private val range: LongRange? = null,
    private val stream: InputStream? = null,
    private val length: Long = 0,
) {
    fun write(out: OutputStream, headOnly: Boolean) {
        val len = when {
            bytes != null -> bytes.size.toLong()
            file != null && range != null -> range.last - range.first + 1
            stream != null -> length
            else -> 0L
        }
        val sb = StringBuilder("HTTP/1.1 $status ${reason(status)}\r\n")
        for ((k, v) in headers) sb.append(k).append(": ").append(v).append("\r\n")
        sb.append("Content-Length: ").append(len).append("\r\n")
        sb.append("Connection: close\r\n\r\n")
        out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
        if (!headOnly) {
            when {
                bytes != null -> out.write(bytes)
                file != null && range != null -> RandomAccessFile(file, "r").use { raf ->
                    raf.seek(range.first)
                    val buf = ByteArray(256 * 1024)
                    var left = len
                    while (left > 0) {
                        val n = raf.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                        if (n < 0) break
                        out.write(buf, 0, n)
                        left -= n
                    }
                }
                stream != null -> stream.use { it.copyTo(out, 256 * 1024) }
            }
        }
        out.flush()
    }

    companion object {
        fun json(status: Int, body: String) = Response(status, mapOf("Content-Type" to "application/json; charset=utf-8", "Cache-Control" to "no-store"), body.toByteArray())
        fun json(status: Int, body: org.json.JSONObject) = json(status, body.toString())
        fun empty(status: Int) = Response(status, emptyMap(), ByteArray(0))
        fun stream(status: Int, type: String, input: InputStream, length: Long) = Response(status, mapOf("Content-Type" to type, "Cache-Control" to "no-cache"), stream = input, length = length)

        /** Datei mit Range-Unterstützung (Videos). */
        fun file(f: File, type: String, rangeHeader: String?): Response {
            val size = f.length()
            val m = rangeHeader?.let { Regex("^bytes=(\\d*)-(\\d*)$").find(it.trim()) }
            if (m != null && (m.groupValues[1].isNotEmpty() || m.groupValues[2].isNotEmpty())) {
                val a = m.groupValues[1]
                val b = m.groupValues[2]
                var start = if (a.isNotEmpty()) a.toLong() else size - b.toLong()
                var end = if (a.isNotEmpty() && b.isNotEmpty()) b.toLong() else size - 1
                start = maxOf(0, start)
                end = minOf(size - 1, end)
                if (start > end) return Response(416, mapOf("Content-Range" to "bytes */$size"), ByteArray(0))
                return Response(206, mapOf("Content-Type" to type, "Accept-Ranges" to "bytes", "Content-Range" to "bytes $start-$end/$size"), file = f, range = start..end)
            }
            return Response(200, mapOf("Content-Type" to type, "Accept-Ranges" to "bytes"), file = f, range = 0L..(size - 1))
        }

        fun mime(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html; charset=utf-8"
            "js" -> "text/javascript; charset=utf-8"
            "css" -> "text/css; charset=utf-8"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "mp4" -> "video/mp4"
            "webm" -> "video/webm"
            "woff2" -> "font/woff2"
            else -> "application/octet-stream"
        }

        private fun reason(s: Int) = when (s) {
            200 -> "OK"; 201 -> "Created"; 204 -> "No Content"; 206 -> "Partial Content"
            400 -> "Bad Request"; 401 -> "Unauthorized"; 403 -> "Forbidden"; 404 -> "Not Found"
            409 -> "Conflict"; 411 -> "Length Required"; 413 -> "Payload Too Large"; 416 -> "Range Not Satisfiable"
            422 -> "Unprocessable Entity"; 429 -> "Too Many Requests"
            else -> if (s >= 500) "Server Error" else "Status"
        }
    }
}

/** Liest höchstens [limit] Bytes; der Rest der Verbindung bleibt unberührt. */
class LimitedInputStream(private val inner: InputStream, private var limit: Long) : InputStream() {
    override fun read(): Int {
        if (limit <= 0) return -1
        val b = inner.read()
        if (b >= 0) limit--
        return b
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (limit <= 0) return -1
        val n = inner.read(b, off, minOf(len.toLong(), limit).toInt())
        if (n > 0) limit -= n
        return n
    }

    override fun available(): Int = minOf(inner.available().toLong(), limit).toInt()
}
