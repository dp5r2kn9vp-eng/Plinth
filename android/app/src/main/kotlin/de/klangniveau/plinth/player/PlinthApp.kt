package de.klangniveau.plinth.player

import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import de.klangniveau.plinth.core.Platform
import de.klangniveau.plinth.core.PlayerCore
import java.io.File
import java.io.InputStream

/**
 * Hält den Kern (Offline-Empfang + lokaler Webserver) für die ganze App.
 * Daten: interner Speicher der App (files/plinth), wird bei Deinstallation entfernt.
 */
class PlinthApp : Application() {

    lateinit var core: PlayerCore
        private set

    private var started = false

    override fun onCreate() {
        super.onCreate()
        // Absturz: in 2 s neu starten (wie der Watchdog unter Windows)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            Log.e(TAG, "Absturz – Neustart", e)
            scheduleRestart(this, 2000)
            previous?.uncaughtException(t, e)
        }
        val app = this
        core = PlayerCore(File(filesDir, "plinth"), object : Platform {
            override val platformName = "android"
            override val version: String = try {
                packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
            } catch (_: Exception) { "?" }

            override fun defaultDeviceName(): String {
                val name = try { Settings.Global.getString(contentResolver, "device_name") } catch (_: Exception) { null }
                return name?.takeIf { it.isNotBlank() } ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()
            }

            override fun uiAsset(path: String): InputStream? = try {
                assets.open("player/$path")
            } catch (_: Exception) { null }

            override fun leaveKiosk(minutes: Int) = Kiosk.leaveFor(app, minutes)
            override fun quit() = Kiosk.quit(app)
            override fun log(level: String, message: String) {
                when (level) {
                    "ERROR" -> Log.e(TAG, message)
                    "WARN" -> Log.w(TAG, message)
                    else -> Log.i(TAG, message)
                }
            }
        })
    }

    /** Startet den Kern einmal pro Prozess (aus dem Vordergrunddienst). */
    @Synchronized fun startCore() {
        if (started) return
        core.start()
        started = true
    }

    companion object {
        const val TAG = "Plinth"

        fun scheduleRestart(ctx: Context, delayMs: Long) {
            val intent = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val pi = PendingIntent.getActivity(ctx, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val am = ctx.getSystemService(AlarmManager::class.java)
            am.set(AlarmManager.RTC, System.currentTimeMillis() + delayMs, pi)
        }
    }
}
