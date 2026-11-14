package de.klangniveau.plinth.player

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Vollbild-Oberfläche: zeigt die Player-Oberfläche (WebView) vom lokalen Webserver des Kerns.
 * Überwacht die Darstellung (Lebenszeichen) und lädt sie bei Hängern oder Abstürzen neu.
 */
class MainActivity : Activity() {
    private var web: WebView? = null
    private val handler = Handler(Looper.getMainLooper())
    private var lastReload = 0L
    private var backPresses = ArrayList<Long>()

    private val app get() = application as PlinthApp
    private val url get() = "http://127.0.0.1:${app.core.port}/app/"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PlayerService.start(this)
        app.startCore()
        Kiosk.attach(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_FULLSCREEN)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        Kiosk.applyPolicies(this)
        if (Kiosk.isQuit(this)) showQuitScreen() else showPlayer()
        Kiosk.askForHomeRoleOnce(this)
        handler.postDelayed(watchdog, 5000)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showPlayer() {
        web?.destroy()
        val w = WebView(this)
        w.setBackgroundColor(Color.BLACK)
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
        }
        w.isFocusable = true
        w.isFocusableInTouchMode = true
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !request.url.toString().startsWith("http://127.0.0.1:") // nichts darf aus dem Player herausnavigieren

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) handler.postDelayed({ web?.loadUrl(url) }, 2000)
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                app.core.log("ERROR", "Darstellung abgestürzt – wird neu aufgebaut")
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                if (web === view) web = null
                handler.post { if (!Kiosk.isQuit(this@MainActivity)) showPlayer() }
                return true
            }
        }
        setContentView(w)
        web = w
        lastReload = System.currentTimeMillis()
        w.loadUrl(url)
        w.requestFocus()
        immersive()
    }

    /** Lebenszeichen der Oberfläche: bleibt es 30 s aus, neu laden; erholt sie sich nicht, Aktivität neu starten. */
    private val watchdog = object : Runnable {
        override fun run() {
            val w = web
            val now = System.currentTimeMillis()
            if (w != null && now - app.core.lastAlive > 30_000 && now - lastReload > 30_000) {
                if (now - lastReload < 120_000) {
                    app.core.log("ERROR", "Darstellung erholt sich nicht – Oberfläche wird neu gestartet")
                    recreate()
                    return
                }
                app.core.log("ERROR", "Darstellung ohne Lebenszeichen – wird neu geladen")
                lastReload = now
                w.reload()
            }
            handler.postDelayed(this, 5000)
        }
    }

    fun showQuitScreen() {
        try { stopLockTask() } catch (_: Exception) {}
        web?.destroy()
        web = null
        val pad = (24 * resources.displayMetrics.density).toInt()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.rgb(14, 17, 22))
            setPadding(pad, pad, pad, pad)
        }
        fun button(text: String, onClick: () -> Unit) = Button(this).apply {
            this.text = text
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = pad / 2 }
        }
        box.addView(TextView(this).apply {
            text = "Plinth Player ist beendet"
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        })
        box.addView(TextView(this).apply {
            text = "Er startet beim nächsten Einschalten wieder von selbst."
            setTextColor(Color.rgb(139, 149, 165))
            gravity = Gravity.CENTER
        })
        val start = button("Player starten") {
            Kiosk.clearQuit(this)
            showPlayer()
            enterKiosk()
        }
        box.addView(start)
        box.addView(button("Android-Einstellungen") { startActivity(Intent(Settings.ACTION_SETTINGS)) })
        box.addView(button("Andere Startbildschirm-App wählen") {
            try {
                startActivity(Intent(Settings.ACTION_HOME_SETTINGS))
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_SETTINGS))
            }
        })
        setContentView(box)
        start.requestFocus()
    }

    private fun enterKiosk() {
        if (Kiosk.isDeviceOwner(this) && !Kiosk.inMaintenance(this) && !Kiosk.isQuit(this)) {
            try { startLockTask() } catch (_: Exception) {}
        }
    }

    override fun onResume() {
        super.onResume()
        Kiosk.attach(this)
        if (!Kiosk.isQuit(this) && web == null) showPlayer()
        enterKiosk()
        immersive()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }

    @Suppress("DEPRECATION")
    private fun immersive() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }

    /** Wartungsmenü: Menü-Taste der Fernbedienung oder 5× schnell „Zurück“. „Zurück“ verlässt den Player nie. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (web == null) return super.onKeyDown(keyCode, event)
        when (keyCode) {
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS -> {
                openMaintenance(); return true
            }
            KeyEvent.KEYCODE_BACK -> {
                val now = System.currentTimeMillis()
                backPresses.removeAll { now - it > 3000 }
                backPresses.add(now)
                if (backPresses.size >= 5) {
                    backPresses.clear()
                    openMaintenance()
                } else {
                    web?.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))", null)
                }
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun openMaintenance() {
        web?.evaluateJavascript("window.__plinthOpenMaintenance && window.__plinthOpenMaintenance()", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web == null) super.onBackPressed()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        web?.destroy()
        web = null
        super.onDestroy()
    }
}
