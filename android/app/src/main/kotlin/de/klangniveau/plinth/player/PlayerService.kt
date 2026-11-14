package de.klangniveau.plinth.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Vordergrunddienst: hält den Offline-Empfang auch dann am Leben, wenn die Oberfläche gerade nicht sichtbar ist
 * (Wartung, Einstellungen). Hält WLAN wach und lässt Broadcasts für die Suche durch.
 */
class PlayerService : Service() {
    private var multicast: WifiManager.MulticastLock? = null
    private var wifi: WifiManager.WifiLock? = null
    private var wake: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Plinth Player", NotificationManager.IMPORTANCE_MIN))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        val n = builder.setContentTitle("Plinth Player").setContentText("Bereit für Inhalte aus Plinth Studio")
            .setSmallIcon(android.R.drawable.ic_media_play).setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(1, n)

        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        multicast = wm.createMulticastLock("plinth-suche").apply { setReferenceCounted(false); acquire() }
        @Suppress("DEPRECATION")
        wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "plinth-wlan").apply { setReferenceCounted(false); acquire() }
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "plinth:empfang").apply { setReferenceCounted(false); acquire() }

        (application as PlinthApp).startCore()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        multicast?.release()
        wifi?.release()
        wake?.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "plinth"

        fun start(ctx: Context) {
            val i = Intent(ctx, PlayerService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }
    }
}
