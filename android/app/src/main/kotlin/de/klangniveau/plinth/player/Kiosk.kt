package de.klangniveau.plinth.player

import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.app.admin.SystemUpdatePolicy
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.UserManager
import android.provider.Settings
import android.util.Log
import java.lang.ref.WeakReference

/**
 * Selbsteinrichtung und Kiosk:
 * - immer: Startbildschirm-App (startet nach dem Booten von selbst), Bildschirm bleibt an, Vollbild
 * - als Device Owner (einmalig per adb oder QR-Einrichtung): Aufgabe gesperrt, kein Sperrbildschirm, keine Statusleiste,
 *   Plinth fest als Startbildschirm, Bildschirm bleibt am Netzteil an, Systemupdates nur nachts
 */
object Kiosk {
    private const val PREFS = "kiosk"
    private val main = Handler(Looper.getMainLooper())
    private var activity: WeakReference<MainActivity>? = null

    fun attach(a: MainActivity) {
        activity = WeakReference(a)
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun admin(ctx: Context) = ComponentName(ctx, AdminReceiver::class.java)

    fun isDeviceOwner(ctx: Context): Boolean =
        ctx.getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(ctx.packageName)

    fun inMaintenance(ctx: Context) = System.currentTimeMillis() < prefs(ctx).getLong("maintenanceUntil", 0)
    fun isQuit(ctx: Context) = prefs(ctx).getBoolean("quit", false)
    fun clearQuit(ctx: Context) = prefs(ctx).edit().putBoolean("quit", false).putLong("maintenanceUntil", 0).apply()

    /** Einmal pro Start: als Device Owner alle Kiosk-Richtlinien setzen. Fehler sind nicht kritisch. */
    fun applyPolicies(a: Activity) {
        if (!isDeviceOwner(a)) return
        val dpm = a.getSystemService(DevicePolicyManager::class.java)
        val admin = admin(a)
        fun tryDo(what: String, f: () -> Unit) = try { f() } catch (e: Exception) { Log.w(PlinthApp.TAG, "Kiosk: $what nicht möglich: ${e.message}") }
        tryDo("Aufgabensperre") { dpm.setLockTaskPackages(admin, arrayOf(a.packageName)) }
        tryDo("Startbildschirm") {
            val filter = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(admin, filter, ComponentName(a, MainActivity::class.java))
        }
        if (Build.VERSION.SDK_INT >= 23) {
            tryDo("Sperrbildschirm") { dpm.setKeyguardDisabled(admin, true) }
            tryDo("Statusleiste") { dpm.setStatusBarDisabled(admin, true) }
            tryDo("Systemupdates") { dpm.setSystemUpdatePolicy(admin, SystemUpdatePolicy.createWindowedInstallPolicy(120, 300)) }
        }
        tryDo("Bildschirm am Netzteil") {
            val all = BatteryManager.BATTERY_PLUGGED_AC or BatteryManager.BATTERY_PLUGGED_USB or BatteryManager.BATTERY_PLUGGED_WIRELESS
            dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, all.toString())
        }
        tryDo("Sicherer Start") { dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT) }
    }

    /** Ohne Device Owner: einmalig fragen, ob Plinth die Startbildschirm-App werden soll (startet dann nach jedem Booten). */
    fun askForHomeRoleOnce(a: Activity) {
        val p = prefs(a)
        if (isDeviceOwner(a) || p.getBoolean("homeAsked", false)) return
        p.edit().putBoolean("homeAsked", true).apply()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                val rm = a.getSystemService(RoleManager::class.java)
                if (rm.isRoleAvailable(RoleManager.ROLE_HOME) && !rm.isRoleHeld(RoleManager.ROLE_HOME)) {
                    a.startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME), 7)
                }
            }
        } catch (e: Exception) {
            Log.w(PlinthApp.TAG, "Startbildschirm-Abfrage nicht möglich: ${e.message}")
        }
    }

    /** Wartung: Kiosk für [minutes] verlassen und die Android-Einstellungen öffnen. Danach automatisch zurück. */
    fun leaveFor(ctx: Context, minutes: Int) {
        prefs(ctx).edit().putLong("maintenanceUntil", System.currentTimeMillis() + minutes * 60_000L).apply()
        val pi = PendingIntent.getBroadcast(ctx, 2, Intent(ctx, ReturnReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        ctx.getSystemService(AlarmManager::class.java).set(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + minutes * 60_000L, pi)
        main.post {
            val a = activity?.get()
            try { a?.stopLockTask() } catch (_: Exception) {}
            try {
                (a ?: ctx).startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: Exception) {}
        }
    }

    fun endMaintenance(ctx: Context) {
        prefs(ctx).edit().putLong("maintenanceUntil", 0).apply()
        ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }

    /** Player beenden: bis zum nächsten Einschalten oder bis „Player starten“ gedrückt wird. */
    fun quit(ctx: Context) {
        prefs(ctx).edit().putBoolean("quit", true).apply()
        main.post { activity?.get()?.showQuitScreen() }
    }
}
