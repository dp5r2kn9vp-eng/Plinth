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
- Ersetzt durch Meilenstein M4 Betreiber & Abrechnung, Plan in docs/ADMINKONSOLE.md

### Download-Zeitfenster & Bandbreitenbegrenzung für Player
`epic:betrieb`

Große Updates nachts laden, Bandbreite begrenzen.

### Datenschutz & Betrieb (AVV, Backups, Monitoring)
`doku, security`

EU-Hosting, Auftragsverarbeitung, Backups der Datenbank, Monitoring.


## M4 Betreiber & Abrechnung
_Admin-Konsole (Laravel): Kunden, Geräte, Speicher, Lizenzen, Rechnungen, Stripe. Plan: docs/ADMINKONSOLE.md_

### Admin-App Grundgerüst (Laravel), Betreiber-Login mit 2FA, Verlauf
`epic:admin, security`

Eigene Laravel-App unter /admin (admin.plinth.klangniveau.de), gleiche DB wie die API, eigene Tabellen mit Präfix adm_.
- Übernahme aus Crewvado: OperatorSurface/OperatorSession, Login, TOTP-Einrichtung, Rate-Limiting
- adm_verlauf: Betreiber, Zeit, Kunde, Aktion, vorher/nachher, Begründung (verschlüsselt)
- Auslieferung per FTP wie Crewvado (vendor im Paket), Webcron für Laravel-Scheduler
- Tests: kein Zugriff ohne 2FA, Kunden-Login gilt nicht in der Konsole

### API: Kundenstatus, Gerätelimit, Speicherkontingent, Studio-Sperre
`epic:cloud, epic:admin, security`

API-Migration (api/migrations): kunden.status, test_bis, max_geraete, speicher_kontingent_bytes, studio_gesperrt, sperr_grund, speicher_ziel, kundennummer.
- Geräteregistrierung nur bis max_geraete, klare Meldung im Player-Setup
- Upload-Init prüft Kontingent (fertige + laufende Uploads), Hinweis ab 80 %
- studio_gesperrt: Upload/Veröffentlichen abgelehnt, Lesen erlaubt, Player-API unverändert
- gekuendigt/abgelaufen: Login gesperrt, Geräte-Tokens ungültig
- Tests je Grenzfall, fremde Kunden-IDs

### Konsole: Kundenliste und Kundenakte (anlegen, Test, sperren, Kundencode)
`epic:admin`

Liste mit Statusfilter (Test, aktiv, Verzug, gesperrt, gekündigt), Suche.
- Kundenakte: Übersicht, Lizenzen & Plugins, Geräte, Speicher, Benutzer, Abrechnung, Verlauf
- Kunde anlegen mit erstem Studio-Benutzer (Einladung), Testphase 14 Tage / 1 Player / 5 GB, verlängern, als Kunde übernehmen
- Sperren/Entsperren, Kundencode neu erzeugen
- Jede Änderung mit Begründung und Bestätigung, doppelte Absendung ohne Wirkung

### Konsole: Geräteübersicht über alle Kunden
`epic:admin, epic:betrieb`

Name, Kunde, Version, letzter Heartbeat, geladene Revision, IP.
- Filter: offline > 1 h, veraltete Version, gesperrt
- Gerät sperren/entfernen (mit Begründung)

### Konsole: Speicher (Messung, Kontingent, Bucket-Abgleich, Kosten)
`epic:admin, epic:storage`

- Nächtliche Messung je Kunde aus dateien in adm_speicher_messungen, Verlauf 90 Tage
- Kontingent je Kunde = 10 GB je Abo-Lizenz + Zusatzspeicher (bzw. Test 5 GB)
- Wöchentlicher Abgleich Bucket ↔ DB: verwaiste Objekte, abgebrochene Multipart-Uploads, Abweichung; keine automatische Löschung
- Größte Dateien je Kunde, geschätzte Anbieterkosten

### Preiskatalog und Verträge
`epic:abrechnung, epic:admin`

Preise netto mit Gültigkeitsdatum: Abo 39,95 €/Monat bzw. 399,50 €/Jahr je Player, Einmal-Kauf 599,95 € (ab 5: 539,95, ab 10: 509,95, ab 25: 479,95), Wartung 119,95 €/Jahr, Cloud-Zusatz 9,95 €/Player/Monat, Zusatzspeicher 9,95 €/50 GB/Monat.
- adm_vertraege mit Preis-Snapshot, Laufzeit, gekündigt zum
- Kostenlose Freischaltung mit Enddatum und Begründung
- Vertragsänderung setzt max_geraete und Kontingent in kunden

### Rechnungssteller, Rechnungen, E-Rechnung (aus Crewvado)
`epic:abrechnung`

Übernahme InvoiceIssuer, EInvoice, PDF.
- Lückenlose Nummern, Snapshot von Steller und Empfänger, USt 19 % / Reverse Charge
- PDF mit ZUGFeRD, XRechnung mit Leitweg-ID
- Gutschrift/Storno, Zahlung von Hand buchen

### Zahlarten über Stripe, Freischaltung „auf Rechnung“
`epic:abrechnung, security`

Übernahme StripeClient, CompanyBillingService.
- Karte und SEPA per SetupIntent, nur Marke + letzte 4 gespeichert
- Off-Session-Einzug je Rechnung mit Idempotenzschlüssel, Webhook für Ergebnis
- „Auf Rechnung“ je Kunde durch Betreiber freischalten/entziehen

### Abo-Lauf: monatlich/jährlich, anteilig, Kündigung
`epic:abrechnung`

Täglicher Lauf (Europe/Berlin): fällige Verträge → Rechnung → Einzug oder Versand (14 Tage Ziel).
- Mehr Lizenzen anteilig taggenau bis gemeinsamem Laufzeitende
- Weniger Lizenzen/Kündigung zum Laufzeitende
- Wiederholbar ohne Doppelrechnung

### Mahnwesen: Studio-Sperre, Player laufen weiter
`epic:abrechnung, epic:betrieb`

Übernahme PaymentDunningService.
- Tag 1 Hinweis im Studio, Tag 7 Erinnerung, Tag 14 studio_gesperrt
- Zahlung oder Betreiberfreigabe (Begründung) hebt sofort auf
- Wiedergabe auf den Playern nie betroffen; Test und Freischaltungen nie betroffen

### Einmal-Kauf, Wartung, Cloud-Zusatz, eigener S3-Bucket
`epic:abrechnung, epic:storage`

- Kauf mit Staffelpreis, Wartung 1 Jahr inklusive, Verlängerung 119,95 €/Lizenz/Jahr
- Nach Wartungsende keine Auto-Updates, Player läuft weiter
- Ohne Cloud-Zusatz: Veröffentlichung in eigenen S3-kompatiblen Bucket des Kunden (Zugangsdaten verschlüsselt, Verbindungstest)
- Mit Cloud-Zusatz: unser Speicher, 10 GB je Player

### Plugins: Katalog und Einmalkauf je Kunde
`epic:abrechnung, epic:admin`

Plugin-Katalog mit Einmalpreis, Kauf gilt für alle Lizenzen des Kunden, Freischaltung in der Kundenakte.

### Monatsabschluss und Stripe-Gebühren
`epic:abrechnung`

Übernahme MonthlyClosing: ZIP mit Rechnungs-PDFs, Übersicht, CSV, XLSX; Abweichungen Stripe ↔ gebuchte Rechnungen; Gebührenübersicht.

### Konsole: Dashboard und Monitoring
`epic:admin, epic:betrieb`

MRR, aktive Lizenzen (Abo/Kauf), Player online/offline, Speicher gesamt vs. Bucket, überfällige Rechnungen, Cron-Status, Datenbankgröße.

### Studio: Abrechnungsseite für Kunden
`epic:abrechnung, epic:designer`

Rechnungsdaten, Zahlarten, Rechnungen als PDF, Lizenzen/Speicher dazubuchen, Kündigung zum Laufzeitende; nur Kunden-Admins.
