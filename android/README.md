# Plinth Player für Android

Der Plinth Player für **Android-Tablets, Android-TV-Boxen und Signage-Displays** (Android 7 und neuer). Er nimmt Inhalte von Plinth Studio Desktop im lokalen Netz an (Offline-Betrieb) – gleiches Protokoll, gleiche Oberfläche und gleicher Renderer wie der Windows-Player. Bedienung: [`docs/offline.md`](../docs/offline.md).

## Installation

1. `PlinthPlayer-x.y.z.apk` auf das Gerät bringen (Download, USB-Stick) und öffnen. Einmalig „Installation aus unbekannten Quellen“ erlauben.
2. App starten. Android fragt einmal, ob **Plinth die Startbildschirm-App** werden soll → **Ja**. Damit startet der Player nach jedem Einschalten von selbst und „Home“ führt immer zurück zum Inhalt.
3. Der Player zeigt **Kopplungscode** und **IP-Adresse** – weiter wie beim Windows-Player in Plinth Studio unter „Geräte“.

Das richtet der Player selbst ein: Start nach dem Booten (Startbildschirm-App + Boot-Empfänger), Bildschirm bleibt an, Vollbild ohne System-Leisten, Hintergrunddienst mit WLAN-Sperre (Empfang auch während der Wartung), Neustart nach Absturz, Neuladen der Darstellung bei Hängern.

### Voller Kiosk (empfohlen für öffentliche Geräte)

Als **Device Owner** sperrt der Player das Gerät komplett: keine Statusleiste, kein Sperrbildschirm, kein Verlassen der App, Plinth fest als Startbildschirm, Bildschirm bleibt am Netzteil an, Systemupdates nur nachts (2–5 Uhr), kein abgesicherter Modus. Einmalig auf einem **frisch zurückgesetzten** Gerät (ohne Google-Konto) per USB:

```bash
adb install PlinthPlayer-x.y.z.apk
```

```bash
adb shell dpm set-device-owner de.klangniveau.plinth.player/.AdminReceiver
```

Danach den Player einmal starten – alle Kiosk-Einstellungen setzt er selbst.

### Wartung

- **Menü-Taste** der Fernbedienung, **5× schnell „Zurück“** oder **5× oben links tippen** → PIN (vom Studio festgelegt; bis dahin gilt der Kopplungscode)
- *Android-Einstellungen 15/60 Minuten*: Kiosk wird verlassen, danach automatisch zurück
- *Player beenden*: bis zum nächsten Einschalten; Bildschirm mit „Player starten“ und „Andere Startbildschirm-App wählen“

## Aufbau

| Modul | Inhalt |
|---|---|
| `core/` | Plattformunabhängiger Kern in Kotlin (läuft auch auf der JVM): Offline-Empfang (`PlayerCore`), Ablage wie beim Windows-Player (`Store`), Kopplung und PIN (`DeviceConfig`), kleiner HTTP-Server (`HttpServer`), UDP-Suche |
| `app/` | Android-Hülle: `MainActivity` (Vollbild-WebView, Wächter), `PlayerService` (Vordergrunddienst), `Kiosk` (Startbildschirm, Device-Owner-Richtlinien, Wartung), `BootReceiver` |
| `app/src/main/assets-extra/android-bridge.js` | stellt `window.plinth` per HTTP bereit – dadurch läuft `player/src/renderer` unverändert |

Die Oberfläche wird beim Bauen aus `player/src/renderer` und `shared/renderer` in die Assets kopiert und vom Kern über `http://127.0.0.1:47800/app/` ausgeliefert (nur für das eigene Gerät erreichbar).

## Entwicklung und Tests

```bash
./gradlew :core:test :core:installDist          # Kern (ohne Android-SDK)
(cd ../studio-desktop && npm ci) && node --test test/interop.test.js   # Studio ↔ Kotlin-Kern
./gradlew :app:assembleRelease                  # APK (braucht Android-SDK, ANDROID_HOME)
```

`core/build/install/plinth-core/bin/plinth-core <ordner> [port] [suchport] [oberflächenordner]` startet den Kern ohne Android – praktisch zum Testen mit dem Studio.

## Signatur

Die CI (`.github/workflows/android.yml`) signiert mit dem Release-Schlüssel aus den Secrets `PLINTH_ANDROID_KEYSTORE` (Base64), `PLINTH_ANDROID_KEYSTORE_PASSWORD`, `PLINTH_ANDROID_KEY_ALIAS`, `PLINTH_ANDROID_KEY_PASSWORD`. Fehlen sie, nimmt sie den **Testschlüssel** `app/test-signing.keystore` (Passwort `plinth-test`, öffentlich) – nur zum Ausprobieren. Vor dem ersten echten Rollout einen eigenen Schlüssel erzeugen und als Secret hinterlegen; ein Wechsel des Schlüssels erfordert eine Neuinstallation auf allen Geräten.
