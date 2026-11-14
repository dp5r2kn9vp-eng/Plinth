package de.klangniveau.plinth.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Nach dem Einschalten oder einem Update: Dienst und Oberfläche starten, „Player beendet“ vergessen. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        Kiosk.clearQuit(ctx)
        try {
            PlayerService.start(ctx)
        } catch (_: Exception) {
            // Direktstart vor dem Entsperren (LOCKED_BOOT) kann scheitern – BOOT_COMPLETED folgt
        }
        // Als Startbildschirm-App öffnet Android die Oberfläche ohnehin; sonst hier versuchen
        try {
            ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            PlinthApp.scheduleRestart(ctx, 3000)
        }
    }
}

/** Ende der Wartungszeit: zurück zum Inhalt. */
class ReturnReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Kiosk.endMaintenance(context.applicationContext)
    }
}

/** Device-Admin-Empfänger (nur nötig, wenn das Gerät als Device Owner eingerichtet wird). */
class AdminReceiver : android.app.admin.DeviceAdminReceiver()
