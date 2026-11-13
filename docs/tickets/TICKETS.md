# Plinth – Tickets


## M1 MVP
_Erster Kunde: Designer, Veröffentlichen, Player, Installer (FTP-Backend)_

### Architektur & Monorepo-Struktur festlegen
`epic:architektur, doku`

Ordner: /api (PHP), /studio (Designer, Web), /player (Windows), /shared (Schemas), /installer, /docs.
- Techstack Player (Electron vs. .NET/WebView2) entschieden und dokumentiert
- Techstack Designer (Web, Konva/Fabric.js) dokumentiert
- Konfiguration über .env, keine Zugangsdaten im Repo

### Manifest-Format spezifizieren (JSON-Schema)
`epic:architektur, doku`

Felder: schemaVersion, revision, publishedAt, validFrom/validTo, priority, layout, files[] (Pfad, Größe, SHA-256).
- JSON-Schema in /shared + Beispiele
- Manifest ist unveränderlich pro Revision

### Layout-Format spezifizieren (Bezugsformat 1920x1080)
`epic:architektur, doku`

Seiten (Home, Videoseite), Elemente (Text, Bild, Thumbnail, Button, Hintergrund) mit x/y/w/h, Ebene, Stil, Aktion (öffnet Video / zurück).
- Relative Koordinaten, Ausrichtung quer/hochkant wählbar
- JSON-Schema + Beispiele

### Datenbank-Schema (MySQL/MariaDB) + Migrationen
`epic:cloud, epic:architektur`

Tabellen: kunden, benutzer, geraete, projekte, entwuerfe, revisionen, dateien, zeitplaene.
- Migrationsskripte
- Seed-Daten für Testkunden

### PHP-API Grundgerüst (Routing, Config, Fehlerformat, Logging)
`epic:cloud`

- Einheitliches JSON-Fehlerformat, Versionierung /api/v1
- Konfiguration per .env, Composer-Setup
- Rate-Limiting für Login und Geräte-Endpunkte

### Auth für Designer-Benutzer (Login, Session/Token)
`epic:cloud, security`

- Passwort-Hashing (Argon2), Login/Logout, Token-Ablauf
- Benutzer gehören zu einem Kunden, Zugriff nur auf eigene Daten

### Kundencode & Gerätetoken (Registrierung, Sperren)
`epic:cloud, epic:player, security`

- Kundencode wird gegen ein Gerätetoken getauscht
- Geräte im Designer sichtbar, einzeln sperrbar
- Token verschlüsselt auf dem Player

### Storage-Interface + S3-Treiber (R2/Hetzner)
`epic:storage`

- Interface: signierte Upload-/Download-URLs, Multipart, exists, delete
- S3-kompatibel (AWS SDK für PHP), Bucket privat
- Zugangsdaten nur serverseitig

### Upload-Endpunkte (Multipart init / Teil-URLs / complete)
`epic:storage, epic:cloud`

- Direkter Browser-Upload in den Speicher, Teile 5-10 MB, Wiederaufnahme
- Server prüft Größe/Hash nach complete
- Test mit Multi-GB-Video

### Veröffentlichen-Endpunkt (Revision & Manifest erzeugen)
`epic:cloud`

- Entwurf einfrieren, Revision hochzählen, Manifest mit Hashes schreiben
- Atomar: Revision wird erst aktiv, wenn alle Dateien vorhanden sind

### Player-API: Revisionsprüfung, Manifest, signierte Download-Links
`epic:cloud, epic:player`

- Leichte Abfrage (nur Revisionsnummer / ETag) für Polling alle 30-60 s
- Antwort mit Manifest + zeitlich begrenzten Download-Links
- Gerät meldet geladene Revision zurück

### Plinth Studio (Designer): Grundgerüst (Web-App, Login, Projekt, Formatwahl)
`epic:designer`

- Projekt pro Kunde, Full HD quer als Standard, hochkant wählbar
- Entwurf speichern/laden, Autosave

### Designer: Canvas mit freier Positionierung
`epic:designer`

- Drag, Größe ändern, Ebenen, Raster/Ausrichtungshilfen, Rückgängig/Wiederholen
- Skalierte Darstellung im Browser, Speicherung relativ zu 1920x1080

### Designer: Elemente Text und Bild
`epic:designer`

- Text: Schrift, Größe, Farbe, Ausrichtung
- Bild hochladen und platzieren

### Designer: Hintergrundbild hochladen
`epic:designer`

- Hintergrundbild oder -farbe pro Seite, Skalierungsmodus (cover/contain)

### Designer: Medienbibliothek (Upload mit Fortschritt & Wiederaufnahme)
`epic:designer, epic:storage`

- Videos/Bilder hochladen, Fortschrittsanzeige, Abbruch/Wiederaufnahme
- Standbild-Vorschau für Videos im Browser erzeugen

### Designer: Thumbnail-Element mit Videoverknüpfung
`epic:designer`

- Video aus Bibliothek wählen, Vorschaubild automatisch oder eigenes Bild
- Klick öffnet Videoseite

### Designer: Videoseite konfigurieren (Header, Zurück-Button)
`epic:designer`

- Header-Leiste mit Zurück-Button zum Homescreen, Farbe/Beschriftung anpassbar
- Rücksprung nach Videoende immer aktiv

### Designer: Vorschau-Modus
`epic:designer`

Klickbare Vorschau, die das Verhalten des Players abbildet (Home -> Video -> zurück).

### Designer: Veröffentlichen (UI, Status, Fehlerbehandlung)
`epic:designer`

- Button, Fortschritt, Erfolgsmeldung mit Revisionsnummer
- Fehlerfall: kein halbfertiger Stand sichtbar

### Plinth Player: Grundgerüst (Vollbild, Kiosk-Modus, Layout-Renderer)
`epic:player`

- Vollbild, Mauszeiger optional aus, Touch/Maus gleich (Pointer-Events)
- Rendert Layout-JSON, skaliert auf Bildschirmauflösung

### Player: Navigation Home -> Video -> Home
`epic:player`

- Thumbnail-Klick öffnet Video, Header mit Zurück-Button
- Nach Videoende automatisch zurück
- Inaktivitäts-Timeout konfigurierbar

### Player: Setup-Dialog für Kundencode
`epic:player, security`

- Beim ersten Start Code eingeben, dauerhaft gespeichert (DPAPI, ProgramData)
- Erneut erreichbar per Tastenkombi + PIN

### Player: Sync-Logik (Polling, Delta-Download, atomarer Wechsel)
`epic:player, epic:storage`

- Beim Start und alle 30-60 s Revision prüfen
- Nur Änderungen laden, fortsetzbar, SHA-256 prüfen, Temp-Ordner
- Umschalten erst wenn komplett, letzte funktionierende Version als Fallback, Offline-Betrieb

### Player: Wartungsmodus (Tastenkombi + PIN: beenden, Windows nutzen)
`epic:player, security`

- Globale Tastenkombination (z. B. Strg+Alt+Shift+K) öffnet PIN-Abfrage, auch bei Touch-Bedienung per Tippfolge in einer Bildschirmecke als Alternative
- Nach richtiger PIN: Wahl Beenden / Wartungsmodus für X Minuten / Setup
- Beim Beenden wird der Watchdog pausiert, sonst startet der Player sofort neu
- Wartungsmodus endet automatisch nach Ablauf oder beim nächsten Windows-Start, Player läuft dann wieder
- Falsche PIN: Sperre nach mehreren Versuchen, kein Hinweis auf dem Bildschirm
- Explorer/Taskleiste im Wartungsmodus verfügbar (bei Kiosk-Härtung berücksichtigen)
- PIN pro Gerät/Kunde konfigurierbar

### Player: Logging & Techniker-Fehleranzeige
`epic:player`

Logdatei mit Rotation unter ProgramData, diskrete Fehleranzeige.

### Player: Watchdog & Kiosk-Härtung
`epic:player, epic:installer`

- Neustart bei Absturz
- Auto-Login/Assigned Access dokumentiert
- Energiesparmodus aus, Update-Zeiten

### Installer (Inno Setup/MSI): Installation, Autostart, Deinstallation
`epic:installer`

- Program Files + ProgramData, Autostart, saubere Deinstallation
- Silent-Installation für Rollout

### Build-Pipeline (GitHub Actions, Windows-Runner)
`epic:installer`

Baut Player + Installer bei Tag, legt Release-Artefakt ab.

### Abnahme mit Echtdaten beim ersten Kunden (2 Player)
`doku`

Checkliste: Installation, Code-Eingabe, Sync großer Videos, Offline, Neustart, Touch-Bedienung, Update einer Revision.


## M2 Betrieb
_Zeitsteuerung, Push, Gerätestatus, Auto-Update_

### Zeitgesteuerte Manifeste (Zeitfenster, Priorität)
`epic:betrieb, epic:player, epic:designer`

- Designer: Zeitfenster beim Veröffentlichen
- Player hält aktive und kommende Manifeste lokal vor, Auswahl per lokaler Uhrzeit, Rückfall auf Standard

### Gerätestatus (Heartbeat, online, Revision, letzter Sync)
`epic:betrieb, epic:designer`

Player meldet Status zurück, Designer zeigt Übersicht pro Kunde.

### Echter Push (optional: Pusher/Ably oder separater Dienst)
`epic:betrieb`

Ersetzt/ergänzt Polling für sofortige Updates, Polling bleibt als Fallback.

### Rollback auf frühere Revision
`epic:betrieb, epic:designer`

Revisionsliste im Designer, ältere Revision erneut aktivieren.

### Auto-Update des Players
`epic:betrieb, epic:installer`

Update-Kanal, Signaturprüfung, Rollback bei Fehler.

### Code-Signing für Installer und Player
`epic:installer, security`

Zertifikat beschaffen, Signierung in Pipeline, keine SmartScreen-Warnung.

### Mehrere Benutzer & Rollen pro Kunde
`epic:cloud, security`

Rollen (Admin, Redakteur), Einladung per E-Mail.


## M3 Cloud
_Backend mit Konten, S3-Speicher, Transcoding_

### Transcoding & Thumbnail-Erzeugung serverseitig
`epic:cloud`

Videos beim Upload in einheitliches H.264-Format umrechnen, Standbild erzeugen.

### Mandantenverwaltung (Kunden anlegen, Geräte, Speicherkontingent)
`epic:cloud`

Admin-Oberfläche für dich als Betreiber.

### Download-Zeitfenster & Bandbreitenbegrenzung für Player
`epic:betrieb`

Große Updates nachts laden, Bandbreite begrenzen.

### Datenschutz & Betrieb (AVV, Backups, Monitoring)
`doku, security`

EU-Hosting, Auftragsverarbeitung, Backups der Datenbank, Monitoring.
