# Offline-Betrieb (ohne Server)

Stand 14.11.2026. Plinth läuft komplett ohne Cloud: **Plinth Studio Desktop** (Windows, macOS) gestaltet und schickt die Inhalte im lokalen Netz direkt an die **Player** (Windows und Android, gleiches Protokoll).

Lizenzprüfung (M5, #68–#82) ist bewusst noch **nicht** enthalten; sie setzt später auf dieses Protokoll auf (Projektschlüssel, signierte Pakete, HTTPS mit Fingerprint).

## Einrichtung

1. **Player installieren:** Android: `PlinthPlayer-x.y.z.apk` installieren und starten, einmal „Startbildschirm-App“ bestätigen (Details und voller Kiosk: [`android/README.md`](../android/README.md)). Windows: `PlinthSetup-x.y.z.exe` ausführen – ohne Parameter. Der Installer richtet Autostart (mit Watchdog), Kiosk-Energieoptionen, Update-Nutzungszeit und die Firewall-Freigabe ein. Der Player startet danach von selbst im Offline-Betrieb und zeigt einen **6-stelligen Kopplungscode** und seine IP-Adresse. Keine Eingabe am Player nötig.
2. **Studio installieren:** `PlinthStudioSetup-x.y.z.exe` (Windows) bzw. `PlinthStudio-x.y.z-mac.dmg` (macOS). Darf auch auf dem Player-PC selbst laufen.
3. Im Studio unter **Geräte**: gefundene Player erscheinen automatisch → **Koppeln** → Kopplungscode eingeben. Ohne Fund (Netze ohne Broadcast): **Player per Adresse koppeln**.
4. **Wartungs-PIN** unter Geräte festlegen; sie wird an alle Player übertragen. Bis dahin gilt am Player der Kopplungscode als PIN.
5. Gestalten → **Veröffentlichen**: Das Studio sendet den Stand an alle Player des Projekts, mit Fortschritt je Player. Übertragen werden nur neue Dateien; der Player schaltet erst um, wenn alles vollständig und per SHA-256 geprüft ist.

Daten des Studios: Windows `%APPDATA%\Plinth Studio\daten`, macOS `~/Library/Application Support/Plinth Studio/daten` (Menü *Datei → Datenordner öffnen*). Zum Sichern genügt dieser Ordner.

### Hinweise

- **macOS:** Die App ist noch nicht signiert/notarisiert (#36). Beim ersten Start: Rechtsklick auf *Plinth Studio* → *Öffnen* → *Öffnen*.
- **Windows SmartScreen:** ebenfalls bis zum Code-Signing „Weitere Informationen → Trotzdem ausführen“.
- Player mit Kundencode (Cloud) gibt es weiter: Installer mit `/KUNDENCODE=… /PIN=…` oder am Player im Wartungsmenü *Mit Plinth Cloud verbinden*. Zurück: *Offline-Betrieb (ohne Server)*.

## Was der Player selbst einrichtet

| Was | Wer |
|---|---|
| Autostart mit Watchdog (alle Benutzer) | Installer (HKLM\…\Run); fehlt er, trägt der Player ihn beim Start fürs aktuelle Konto ein |
| Bildschirm/PC schlafen nie, Ruhezustand aus | Installer (Kiosk-Einstellungen sind jetzt Standard) und einmalig der Player selbst |
| Windows-Update-Nutzungszeit 6–23 Uhr, Kantenwischen aus | Installer |
| Firewall: TCP 47800, UDP 47801 für `Plinth.exe` | Installer |
| Geräte-ID, Kopplungscode, Name (= Computername) | Player beim ersten Start |
| Wartungs-PIN, Gerätename | Studio beim Koppeln/Veröffentlichen |

Auto-Login des Windows-Kontos bleibt eine Entscheidung des Betreibers (siehe `kiosk-einrichtung.md`).

## Protokoll (Version 1)

Der Player lauscht auf **TCP 47800** (HTTP, JSON) und **UDP 47801** (Suche). Umsetzungen: `player/src/offline.js` (Windows-Player), `android/core/…/PlayerCore.kt` (Android-Player) und `studio-desktop/src/players.js` (Studio). `android/test/interop.test.js` prüft Studio gegen den Android-Kern.

**Suche:** Das Studio schickt `PLINTH-SUCHE` per UDP-Broadcast an Port 47801; jeder Player antwortet an den Absender mit dem JSON von `/info`.

| Methode, Pfad | Auth | Inhalt |
|---|---|---|
| `GET /plinth/v1/info` | – | `{app:"plinth-player", protocol:1, version, deviceId, name, platform, port, paired, projekt:{id,name,revision}\|null}` |
| `POST /plinth/v1/koppeln` | – | `{code, studio, studioId, name?, pin?}` → `{token, …info}`. Falscher Code 403, nach 5 Fehlversuchen 5 min gesperrt (429). Token wird nur als SHA-256 gespeichert. |
| `POST /plinth/v1/pruefen` | Bearer | `{files:[{path,size,sha256}]}` → `{missing:[{path, offset}]}` (`offset` = bereits angefangene Bytes) |
| `PUT /plinth/v1/medien/<sha256>.<ext>?offset=N` | Bearer | Rohdaten ab Byte N, Header `X-Plinth-Size` = Gesamtgröße. → `{offset, complete}`. Falscher Startpunkt 409 mit `offset`, falsche Prüfsumme 422 (Datei verworfen). |
| `POST /plinth/v1/aktivieren` | Bearer | `{manifest, projekt:{id,name}}`. Manifest wie Cloud (`shared/schemas/manifest.schema.json`). Fehlen Dateien: 409 mit `missing`. Sonst atomarer Wechsel, voriger Stand bleibt als Rückfall. |
| `POST /plinth/v1/einstellungen` | Bearer | `{name?, pin?, hideCursor?}` |

Ablage auf dem Player wie beim Cloud-Sync (`media/<sha256>.<ext>`, `manifests/`, `state.json`), damit Rückfall, Aufräumen und Wiedergabe identisch sind.

**Sicherheit (Stand jetzt):** HTTP ohne Verschlüsselung im lokalen Netz; Schutz über den Kopplungscode (nur am Bildschirm sichtbar) und ein zufälliges Token je Studio. HTTPS mit Zertifikat-Fingerprint und signierte Projektpakete kommen mit M5.

## Plattformen

| Teil | Windows | macOS | Android |
|---|---|---|---|
| Studio Desktop | ✓ Installer (NSIS) | ✓ DMG (Intel + Apple Silicon) | – |
| Player | ✓ Installer (Inno Setup) | – | ✓ APK (Android 7+, Tablets, TV-Boxen; gleiche Oberfläche und gleicher Renderer) |
