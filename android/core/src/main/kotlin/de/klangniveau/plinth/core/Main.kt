package de.klangniveau.plinth.core

import java.io.File
import java.io.InputStream

/**
 * Kern ohne Android starten (Interop-Tests mit Plinth Studio, Entwicklung):
 *   plinth-core <datenordner> [httpPort] [suchPort] [oberflächenordner]
 * Gibt eine Zeile "BEREIT <httpPort> <suchPort>" aus, sobald der Empfang läuft.
 */
fun main(args: Array<String>) {
    val dir = File(args.getOrElse(0) { "plinth-data" })
    val ui = args.getOrNull(3)?.let { File(it) }
    val platform = object : Platform {
        override val platformName = "android"
        override val version = System.getenv("PLINTH_VERSION") ?: "dev"
        override fun defaultDeviceName() = "Plinth Android (JVM)"
        override fun uiAsset(path: String): InputStream? = ui?.let { File(it, path) }?.takeIf { it.isFile && it.canonicalPath.startsWith(ui.canonicalPath) }?.inputStream()
        override fun log(level: String, message: String) = System.err.println("$level $message")
    }
    val core = PlayerCore(dir, platform, args.getOrNull(1)?.toInt() ?: PlayerCore.HTTP_PORT, args.getOrNull(2)?.toInt() ?: PlayerCore.DISCOVERY_PORT)
    core.start()
    println("BEREIT ${core.port} ${core.discoveryLocalPort} ${core.config.pairCode}")
    System.out.flush()
    Thread.currentThread().join()
}
