#!/usr/bin/env python3
"""Tickets fuer Plinth. Nutzung:
  python3 tickets.py md            -> schreibt TICKETS.md
  python3 tickets.py create OWNER/REPO  -> legt Labels, Milestones, Issues per gh an
"""
import json, subprocess, sys

MILESTONES = {
    "M1 MVP": "Erster Kunde: Designer, Veröffentlichen, Player, Installer (FTP-Backend)",
    "M2 Betrieb": "Zeitsteuerung, Push, Gerätestatus, Auto-Update",
    "M3 Cloud": "Backend mit Konten, S3-Speicher, Transcoding",
    "M4 Betreiber & Abrechnung": "Admin-Konsole (Laravel): Kunden, Geräte, Speicher, Lizenzen, Rechnungen, Stripe. Plan: docs/ADMINKONSOLE.md",
    "M5 Offline-Lizenzierung": "Player offline per Maschinencode lizenzieren: signierte Geräteliste je Lizenz, Offline-Aktivierung, Deployment im lokalen Netz",
}
LABELS = ["epic:architektur", "epic:designer", "epic:player", "epic:installer",
          "epic:storage", "epic:betrieb", "epic:cloud", "epic:admin", "epic:abrechnung", "epic:lizenz", "security", "doku"]

# (Titel, Milestone, Labels, Beschreibung inkl. Akzeptanzkriterien)
T = [
 # ---------------- M1 MVP ----------------
 ("Architektur & Monorepo-Struktur festlegen", "M1 MVP", ["epic:architektur", "doku"],
  "Ordner: /api (PHP), /studio (Designer, Web), /player (Windows), /shared (Schemas), /installer, /docs.\n- Techstack Player (Electron vs. .NET/WebView2) entschieden und dokumentiert\n- Techstack Designer (Web, Konva/Fabric.js) dokumentiert\n- Konfiguration über .env, keine Zugangsdaten im Repo"),
 ("Manifest-Format spezifizieren (JSON-Schema)", "M1 MVP", ["epic:architektur", "doku"],
  "Felder: schemaVersion, revision, publishedAt, validFrom/validTo, priority, layout, files[] (Pfad, Größe, SHA-256).\n- JSON-Schema in /shared + Beispiele\n- Manifest ist unveränderlich pro Revision"),
 ("Layout-Format spezifizieren (Bezugsformat 1920x1080)", "M1 MVP", ["epic:architektur", "doku"],
  "Seiten (Home, Videoseite), Elemente (Text, Bild, Thumbnail, Button, Hintergrund) mit x/y/w/h, Ebene, Stil, Aktion (öffnet Video / zurück).\n- Relative Koordinaten, Ausrichtung quer/hochkant wählbar\n- JSON-Schema + Beispiele"),
 ("Datenbank-Schema (MySQL/MariaDB) + Migrationen", "M1 MVP", ["epic:cloud", "epic:architektur"],
  "Tabellen: kunden, benutzer, geraete, projekte, entwuerfe, revisionen, dateien, zeitplaene.\n- Migrationsskripte\n- Seed-Daten für Testkunden"),
 ("PHP-API Grundgerüst (Routing, Config, Fehlerformat, Logging)", "M1 MVP", ["epic:cloud"],
  "- Einheitliches JSON-Fehlerformat, Versionierung /api/v1\n- Konfiguration per .env, Composer-Setup\n- Rate-Limiting für Login und Geräte-Endpunkte"),
 ("Auth für Designer-Benutzer (Login, Session/Token)", "M1 MVP", ["epic:cloud", "security"],
  "- Passwort-Hashing (Argon2), Login/Logout, Token-Ablauf\n- Benutzer gehören zu einem Kunden, Zugriff nur auf eigene Daten"),
 ("Kundencode & Gerätetoken (Registrierung, Sperren)", "M1 MVP", ["epic:cloud", "epic:player", "security"],
  "- Kundencode wird gegen ein Gerätetoken getauscht\n- Geräte im Designer sichtbar, einzeln sperrbar\n- Token verschlüsselt auf dem Player"),
 ("Storage-Interface + S3-Treiber (R2/Hetzner)", "M1 MVP", ["epic:storage"],
  "- Interface: signierte Upload-/Download-URLs, Multipart, exists, delete\n- S3-kompatibel (AWS SDK für PHP), Bucket privat\n- Zugangsdaten nur serverseitig"),
 ("Upload-Endpunkte (Multipart init / Teil-URLs / complete)", "M1 MVP", ["epic:storage", "epic:cloud"],
  "- Direkter Browser-Upload in den Speicher, Teile 5-10 MB, Wiederaufnahme\n- Server prüft Größe/Hash nach complete\n- Test mit Multi-GB-Video"),
 ("Veröffentlichen-Endpunkt (Revision & Manifest erzeugen)", "M1 MVP", ["epic:cloud"],
  "- Entwurf einfrieren, Revision hochzählen, Manifest mit Hashes schreiben\n- Atomar: Revision wird erst aktiv, wenn alle Dateien vorhanden sind"),
 ("Player-API: Revisionsprüfung, Manifest, signierte Download-Links", "M1 MVP", ["epic:cloud", "epic:player"],
  "- Leichte Abfrage (nur Revisionsnummer / ETag) für Polling alle 30-60 s\n- Antwort mit Manifest + zeitlich begrenzten Download-Links\n- Gerät meldet geladene Revision zurück"),
 ("Plinth Studio (Designer): Grundgerüst (Web-App, Login, Projekt, Formatwahl)", "M1 MVP", ["epic:designer"],
  "- Projekt pro Kunde, Full HD quer als Standard, hochkant wählbar\n- Entwurf speichern/laden, Autosave"),
 ("Designer: Canvas mit freier Positionierung", "M1 MVP", ["epic:designer"],
  "- Drag, Größe ändern, Ebenen, Raster/Ausrichtungshilfen, Rückgängig/Wiederholen\n- Skalierte Darstellung im Browser, Speicherung relativ zu 1920x1080"),
 ("Designer: Elemente Text und Bild", "M1 MVP", ["epic:designer"],
  "- Text: Schrift, Größe, Farbe, Ausrichtung\n- Bild hochladen und platzieren"),
 ("Designer: Hintergrundbild hochladen", "M1 MVP", ["epic:designer"],
  "- Hintergrundbild oder -farbe pro Seite, Skalierungsmodus (cover/contain)"),
 ("Designer: Medienbibliothek (Upload mit Fortschritt & Wiederaufnahme)", "M1 MVP", ["epic:designer", "epic:storage"],
  "- Videos/Bilder hochladen, Fortschrittsanzeige, Abbruch/Wiederaufnahme\n- Standbild-Vorschau für Videos im Browser erzeugen"),
 ("Designer: Thumbnail-Element mit Videoverknüpfung", "M1 MVP", ["epic:designer"],
  "- Video aus Bibliothek wählen, Vorschaubild automatisch oder eigenes Bild\n- Klick öffnet Videoseite"),
 ("Designer: Videoseite konfigurieren (Header, Zurück-Button)", "M1 MVP", ["epic:designer"],
  "- Header-Leiste mit Zurück-Button zum Homescreen, Farbe/Beschriftung anpassbar\n- Rücksprung nach Videoende immer aktiv"),
 ("Designer: Vorschau-Modus", "M1 MVP", ["epic:designer"],
  "Klickbare Vorschau, die das Verhalten des Players abbildet (Home -> Video -> zurück)."),
 ("Designer: Veröffentlichen (UI, Status, Fehlerbehandlung)", "M1 MVP", ["epic:designer"],
  "- Button, Fortschritt, Erfolgsmeldung mit Revisionsnummer\n- Fehlerfall: kein halbfertiger Stand sichtbar"),
 ("Plinth Player: Grundgerüst (Vollbild, Kiosk-Modus, Layout-Renderer)", "M1 MVP", ["epic:player"],
  "- Vollbild, Mauszeiger optional aus, Touch/Maus gleich (Pointer-Events)\n- Rendert Layout-JSON, skaliert auf Bildschirmauflösung"),
 ("Player: Navigation Home -> Video -> Home", "M1 MVP", ["epic:player"],
  "- Thumbnail-Klick öffnet Video, Header mit Zurück-Button\n- Nach Videoende automatisch zurück\n- Inaktivitäts-Timeout konfigurierbar"),
 ("Player: Setup-Dialog für Kundencode", "M1 MVP", ["epic:player", "security"],
  "- Beim ersten Start Code eingeben, dauerhaft gespeichert (DPAPI, ProgramData)\n- Erneut erreichbar per Tastenkombi + PIN"),
 ("Player: Sync-Logik (Polling, Delta-Download, atomarer Wechsel)", "M1 MVP", ["epic:player", "epic:storage"],
  "- Beim Start und alle 30-60 s Revision prüfen\n- Nur Änderungen laden, fortsetzbar, SHA-256 prüfen, Temp-Ordner\n- Umschalten erst wenn komplett, letzte funktionierende Version als Fallback, Offline-Betrieb"),
 ("Player: Wartungsmodus (Tastenkombi + PIN: beenden, Windows nutzen)", "M1 MVP", ["epic:player", "security"],
  "- Globale Tastenkombination (z. B. Strg+Alt+Shift+K) öffnet PIN-Abfrage, auch bei Touch-Bedienung per Tippfolge in einer Bildschirmecke als Alternative\n- Nach richtiger PIN: Wahl Beenden / Wartungsmodus für X Minuten / Setup\n- Beim Beenden wird der Watchdog pausiert, sonst startet der Player sofort neu\n- Wartungsmodus endet automatisch nach Ablauf oder beim nächsten Windows-Start, Player läuft dann wieder\n- Falsche PIN: Sperre nach mehreren Versuchen, kein Hinweis auf dem Bildschirm\n- Explorer/Taskleiste im Wartungsmodus verfügbar (bei Kiosk-Härtung berücksichtigen)\n- PIN pro Gerät/Kunde konfigurierbar"),
 ("Player: Logging & Techniker-Fehleranzeige", "M1 MVP", ["epic:player"],
  "Logdatei mit Rotation unter ProgramData, diskrete Fehleranzeige."),
 ("Player: Watchdog & Kiosk-Härtung", "M1 MVP", ["epic:player", "epic:installer"],
  "- Neustart bei Absturz\n- Auto-Login/Assigned Access dokumentiert\n- Energiesparmodus aus, Update-Zeiten"),
 ("Installer (Inno Setup/MSI): Installation, Autostart, Deinstallation", "M1 MVP", ["epic:installer"],
  "- Program Files + ProgramData, Autostart, saubere Deinstallation\n- Silent-Installation für Rollout"),
 ("Build-Pipeline (GitHub Actions, Windows-Runner)", "M1 MVP", ["epic:installer"],
  "Baut Player + Installer bei Tag, legt Release-Artefakt ab."),
 ("Abnahme mit Echtdaten beim ersten Kunden (2 Player)", "M1 MVP", ["doku"],
  "Checkliste: Installation, Code-Eingabe, Sync großer Videos, Offline, Neustart, Touch-Bedienung, Update einer Revision."),
 # ---------------- M2 Betrieb ----------------
 ("Zeitgesteuerte Manifeste (Zeitfenster, Priorität)", "M2 Betrieb", ["epic:betrieb", "epic:player", "epic:designer"],
  "- Designer: Zeitfenster beim Veröffentlichen\n- Player hält aktive und kommende Manifeste lokal vor, Auswahl per lokaler Uhrzeit, Rückfall auf Standard"),
 ("Gerätestatus (Heartbeat, online, Revision, letzter Sync)", "M2 Betrieb", ["epic:betrieb", "epic:designer"],
  "Player meldet Status zurück, Designer zeigt Übersicht pro Kunde."),
 ("Echter Push (optional: Pusher/Ably oder separater Dienst)", "M2 Betrieb", ["epic:betrieb"],
  "Ersetzt/ergänzt Polling für sofortige Updates, Polling bleibt als Fallback."),
 ("Rollback auf frühere Revision", "M2 Betrieb", ["epic:betrieb", "epic:designer"],
  "Revisionsliste im Designer, ältere Revision erneut aktivieren."),
 ("Auto-Update des Players", "M2 Betrieb", ["epic:betrieb", "epic:installer"],
  "Update-Kanal, Signaturprüfung, Rollback bei Fehler."),
 ("Code-Signing für Installer und Player", "M2 Betrieb", ["epic:installer", "security"],
  "Zertifikat beschaffen, Signierung in Pipeline, keine SmartScreen-Warnung."),
 ("Mehrere Benutzer & Rollen pro Kunde", "M2 Betrieb", ["epic:cloud", "security"],
  "Rollen (Admin, Redakteur), Einladung per E-Mail."),
 # ---------------- M3 Cloud ----------------
 ("Transcoding & Thumbnail-Erzeugung serverseitig", "M3 Cloud", ["epic:cloud"],
  "Videos beim Upload in einheitliches H.264-Format umrechnen, Standbild erzeugen."),
 ("Mandantenverwaltung (Kunden anlegen, Geräte, Speicherkontingent)", "M3 Cloud", ["epic:cloud"],
  "Admin-Oberfläche für dich als Betreiber.\n- Ersetzt durch Meilenstein M4 Betreiber & Abrechnung, Plan in docs/ADMINKONSOLE.md"),
 ("Download-Zeitfenster & Bandbreitenbegrenzung für Player", "M3 Cloud", ["epic:betrieb"],
  "Große Updates nachts laden, Bandbreite begrenzen."),
 ("Datenschutz & Betrieb (AVV, Backups, Monitoring)", "M3 Cloud", ["doku", "security"],
  "EU-Hosting, Auftragsverarbeitung, Backups der Datenbank, Monitoring."),
 # ---------------- M4 Betreiber & Abrechnung ----------------
 ('Admin-App Grundgerüst (Laravel), Betreiber-Login mit 2FA, Verlauf', 'M4 Betreiber & Abrechnung', ['epic:admin', 'security'],
  'Eigene Laravel-App unter /admin (admin.plinth.klangniveau.de), gleiche DB wie die API, eigene Tabellen mit Präfix adm_.\n- Übernahme aus Crewvado: OperatorSurface/OperatorSession, Login, TOTP-Einrichtung, Rate-Limiting\n- adm_verlauf: Betreiber, Zeit, Kunde, Aktion, vorher/nachher, Begründung (verschlüsselt)\n- Auslieferung per FTP wie Crewvado (vendor im Paket), Webcron für Laravel-Scheduler\n- Tests: kein Zugriff ohne 2FA, Kunden-Login gilt nicht in der Konsole'),
 ('API: Kundenstatus, Gerätelimit, Speicherkontingent, Studio-Sperre', 'M4 Betreiber & Abrechnung', ['epic:cloud', 'epic:admin', 'security'],
  'API-Migration (api/migrations): kunden.status, test_bis, max_geraete, speicher_kontingent_bytes, studio_gesperrt, sperr_grund, speicher_ziel, kundennummer.\n- Geräteregistrierung nur bis max_geraete, klare Meldung im Player-Setup\n- Upload-Init prüft Kontingent (fertige + laufende Uploads), Hinweis ab 80 %\n- studio_gesperrt: Upload/Veröffentlichen abgelehnt, Lesen erlaubt, Player-API unverändert\n- gekuendigt/abgelaufen: Login gesperrt, Geräte-Tokens ungültig\n- Tests je Grenzfall, fremde Kunden-IDs'),
 ('Konsole: Kundenliste und Kundenakte (anlegen, Test, sperren, Kundencode)', 'M4 Betreiber & Abrechnung', ['epic:admin'],
  'Liste mit Statusfilter (Test, aktiv, Verzug, gesperrt, gekündigt), Suche.\n- Kundenakte: Übersicht, Lizenzen & Plugins, Geräte, Speicher, Benutzer, Abrechnung, Verlauf\n- Kunde anlegen mit erstem Studio-Benutzer (Einladung), Testphase 14 Tage / 1 Player / 5 GB, verlängern, als Kunde übernehmen\n- Sperren/Entsperren, Kundencode neu erzeugen\n- Jede Änderung mit Begründung und Bestätigung, doppelte Absendung ohne Wirkung'),
 ('Konsole: Geräteübersicht über alle Kunden', 'M4 Betreiber & Abrechnung', ['epic:admin', 'epic:betrieb'],
  'Name, Kunde, Version, letzter Heartbeat, geladene Revision, IP.\n- Filter: offline > 1 h, veraltete Version, gesperrt\n- Gerät sperren/entfernen (mit Begründung)'),
 ('Konsole: Speicher (Messung, Kontingent, Bucket-Abgleich, Kosten)', 'M4 Betreiber & Abrechnung', ['epic:admin', 'epic:storage'],
  '- Nächtliche Messung je Kunde aus dateien in adm_speicher_messungen, Verlauf 90 Tage\n- Kontingent je Kunde = 10 GB je Abo-Lizenz + Zusatzspeicher (bzw. Test 5 GB)\n- Wöchentlicher Abgleich Bucket ↔ DB: verwaiste Objekte, abgebrochene Multipart-Uploads, Abweichung; keine automatische Löschung\n- Größte Dateien je Kunde, geschätzte Anbieterkosten'),
 ('Preiskatalog und Verträge', 'M4 Betreiber & Abrechnung', ['epic:abrechnung', 'epic:admin'],
  'Preise netto mit Gültigkeitsdatum: Abo 39,95 €/Monat bzw. 399,50 €/Jahr je Player, Einmal-Kauf 599,95 € (ab 5: 539,95, ab 10: 509,95, ab 25: 479,95), Wartung 119,95 €/Jahr, Cloud-Zusatz 9,95 €/Player/Monat, Zusatzspeicher 9,95 €/50 GB/Monat.\n- adm_vertraege mit Preis-Snapshot, Laufzeit, gekündigt zum\n- Kostenlose Freischaltung mit Enddatum und Begründung\n- Vertragsänderung setzt max_geraete und Kontingent in kunden'),
 ('Rechnungssteller, Rechnungen, E-Rechnung (aus Crewvado)', 'M4 Betreiber & Abrechnung', ['epic:abrechnung'],
  'Übernahme InvoiceIssuer, EInvoice, PDF.\n- Lückenlose Nummern, Snapshot von Steller und Empfänger, USt 19 % / Reverse Charge\n- PDF mit ZUGFeRD, XRechnung mit Leitweg-ID\n- Gutschrift/Storno, Zahlung von Hand buchen'),
 ('Zahlarten über Stripe, Freischaltung „auf Rechnung“', 'M4 Betreiber & Abrechnung', ['epic:abrechnung', 'security'],
  'Übernahme StripeClient, CompanyBillingService.\n- Karte und SEPA per SetupIntent, nur Marke + letzte 4 gespeichert\n- Off-Session-Einzug je Rechnung mit Idempotenzschlüssel, Webhook für Ergebnis\n- „Auf Rechnung“ je Kunde durch Betreiber freischalten/entziehen'),
 ('Abo-Lauf: monatlich/jährlich, anteilig, Kündigung', 'M4 Betreiber & Abrechnung', ['epic:abrechnung'],
  'Täglicher Lauf (Europe/Berlin): fällige Verträge → Rechnung → Einzug oder Versand (14 Tage Ziel).\n- Mehr Lizenzen anteilig taggenau bis gemeinsamem Laufzeitende\n- Weniger Lizenzen/Kündigung zum Laufzeitende\n- Wiederholbar ohne Doppelrechnung'),
 ('Mahnwesen: Studio-Sperre, Player laufen weiter', 'M4 Betreiber & Abrechnung', ['epic:abrechnung', 'epic:betrieb'],
  'Übernahme PaymentDunningService.\n- Tag 1 Hinweis im Studio, Tag 7 Erinnerung, Tag 14 studio_gesperrt\n- Zahlung oder Betreiberfreigabe (Begründung) hebt sofort auf\n- Wiedergabe auf den Playern nie betroffen; Test und Freischaltungen nie betroffen'),
 ('Einmal-Kauf, Wartung, Cloud-Zusatz, eigener S3-Bucket', 'M4 Betreiber & Abrechnung', ['epic:abrechnung', 'epic:storage'],
  '- Kauf mit Staffelpreis, Wartung 1 Jahr inklusive, Verlängerung 119,95 €/Lizenz/Jahr\n- Nach Wartungsende keine Auto-Updates, Player läuft weiter\n- Ohne Cloud-Zusatz: Veröffentlichung in eigenen S3-kompatiblen Bucket des Kunden (Zugangsdaten verschlüsselt, Verbindungstest)\n- Mit Cloud-Zusatz: unser Speicher, 10 GB je Player'),
 ('Plugins: Katalog und Einmalkauf je Kunde', 'M4 Betreiber & Abrechnung', ['epic:abrechnung', 'epic:admin'],
  'Plugin-Katalog mit Einmalpreis, Kauf gilt für alle Lizenzen des Kunden, Freischaltung in der Kundenakte.'),
 ('Monatsabschluss und Stripe-Gebühren', 'M4 Betreiber & Abrechnung', ['epic:abrechnung'],
  'Übernahme MonthlyClosing: ZIP mit Rechnungs-PDFs, Übersicht, CSV, XLSX; Abweichungen Stripe ↔ gebuchte Rechnungen; Gebührenübersicht.'),
 ('Konsole: Dashboard und Monitoring', 'M4 Betreiber & Abrechnung', ['epic:admin', 'epic:betrieb'],
  'MRR, aktive Lizenzen (Abo/Kauf), Player online/offline, Speicher gesamt vs. Bucket, überfällige Rechnungen, Cron-Status, Datenbankgröße.'),
 ('Studio: Abrechnungsseite für Kunden', 'M4 Betreiber & Abrechnung', ['epic:abrechnung', 'epic:designer'],
  'Rechnungsdaten, Zahlarten, Rechnungen als PDF, Lizenzen/Speicher dazubuchen, Kündigung zum Laufzeitende; nur Kunden-Admins.'),
 # ---------------- M5 Offline-Lizenzierung ----------------
 ('Lizenzierung: Formate für Lizenzdatei, Anforderungsdatei und signiertes Projektpaket', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:architektur', 'doku', 'security'],
  'Grundprinzip: Die Lizenz gehört zu den Geräten, nicht zum Projekt. Pro Lizenz gibt es genau eine vom Server signierte Liste aktivierter Geräte; alle Projekte teilen sie.\n- JSON-Schema in /shared für lizenz.lic: format, licenseId, customer, issuedAt, serial, maxDevices, features, validUntil, renewBefore, updatesUntil, allowVm, allowUsb, devices[] (code, label, factors[]), Projektschlüssel (öffentlich), kid, sig\n- Kanonische Serialisierung, Signatur Ed25519 über den license-Teil, kid für Schlüsselwechsel\n- Schema für die Anforderungsdatei (.req): licenseId, currentSerial, requestedDevices[], nonce\n- Manifest um licenseId und Signatur mit dem Projektschlüssel erweitern\n- Beispiele und Testvektoren (gültig, manipuliert, alte serial)'),
 ('Player: Maschinencode aus Hardware-Merkmalen mit Toleranzabgleich', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:player', 'security'],
  'Merkmale unter Windows: SMBIOS-UUID, Mainboard-Seriennummer, Seriennummer Systemlaufwerk, ProcessorId, MAC der eingebauten NIC (ohne virtuelle/USB-Adapter), TPM-2.0-Endorsement-Key falls vorhanden.\n- Einzelmerkmale normalisieren, mit Produkt-Salt per SHA-256 hashen; Maschinencode = Hash über sortierte Einzelhashes, Anzeige 5x5 Zeichen mit Prüfziffer\n- Bei jedem Start neu berechnen, nie als Wert speichern (geklonte Images bekommen neuen Code)\n- Toleranz: starkes Merkmal (UUID oder TPM) passt und mindestens 3 von 5 Merkmalen stimmen\n- Hypervisor-Erkennung; in VMs nur mit allowVm\n- Tests: Tausch NIC, Tausch Festplatte, Klon auf andere Hardware, VM'),
 ('API: Lizenzen, Geräteplätze und Signatur der Lizenzdatei', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:cloud', 'security'],
  'Tabellen für Lizenzen, Geräteplätze (registriert/aktiv), Ausstellungen (serial) und Wechsel.\n- maxDevices aus dem Vertrag (Bezug zu Gerätelimit/max_geraete)\n- Signatur mit Ed25519, privater Schlüssel nur in KMS/HSM, nie in .env oder Repo\n- Jede Neuausstellung erhöht serial und wird protokolliert\n- Tests: mehr Geräte als maxDevices abgelehnt, fremde licenseId abgelehnt'),
 ('API: Online-Aktivierung eines Players per Lizenzschlüssel', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:cloud', 'epic:player'],
  'Endpunkt: Lizenzschlüssel + Maschinencode + Einzelhashes, Antwort ist die neue signierte Lizenzdatei.\n- Freier Platz nötig, sonst klare Fehlermeldung mit Hinweis auf Lizenzerweiterung\n- Rate-Limiting, idempotent bei erneuter Aktivierung desselben Geräts\n- Optional: Player fragt alle 30 Tage nach neuerer Lizenzdatei, wenn Internet vorhanden'),
 ('Kundenportal: Offline-Aktivierung per Anforderungsdatei', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:cloud', 'epic:designer'],
  'Kunde lädt die .req-Datei von einem beliebigen Rechner mit Internet hoch (alternativ QR-Code per Handy) und erhält die signierte lizenz.lic.\n- Prüfung: Gerätezahl, Wechsel-Kontingent, currentSerial passt\n- Anzeige der aktiven und registrierten Geräte, Download der aktuellen Lizenzdatei\n- Fehlerfälle verständlich erklären'),
 ('API: Gerätewechsel, Freigabecodes, Wechsel-Kontingent und Lease-Erneuerung', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:cloud', 'security'],
  'Schließt die Wechsel-Lücke: ein abgelöstes Gerät darf nicht offline weiterlaufen.\n- Freigabecode (HMAC aus Maschinencode, serial, Player-Geheimnis) gibt einen Platz sofort frei\n- Ohne Freigabecode wird der Platz erst nach Ablauf von renewBefore der alten Lizenz frei\n- Wechsel-Kontingent: 4 Wechsel je 12 Monate, danach nur über Support\n- renewBefore Standard 180 Tage, Erneuerung online oder per Anforderungsdatei\n- Werte (Lease-Dauer, Kontingent) konfigurierbar, endgültige Werte noch offen'),
 ('Konsole: Lizenzen und Geräteplätze verwalten (Support)', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:admin'],
  'In der Kundenakte: Lizenzen, aktive und registrierte Geräte, Ausstellungen mit serial, Wechsel-Kontingent.\n- Support-Aktionen: Platz ohne Freigabecode freigeben (Hardwaredefekt), Kontingent erhöhen, allowUsb/allowVm setzen\n- Jede Aktion mit Begründung im Verlauf'),
 ('Designer (offline): Geräteverwaltung, Anforderungsdatei und Lizenzimport', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:designer'],
  'Geräte registrieren per Eingabe, QR oder geraet.id-Datei; Liste mit Status registriert/aktiv und Anzeige „x von N Plätzen belegt“.\n- Aktiv nur bis maxDevices wählbar; Austausch nur durch Abwählen eines aktiven Geräts\n- Anforderungsdatei erzeugen, signierte Lizenzdatei importieren und prüfen\n- Designer erzeugt keine Gerätefreigaben selbst, er prüft nur'),
 ('Designer (offline): Projektschlüssel und signiertes Projektpaket', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:designer', 'security'],
  'Projektschlüssel bei der ersten Aktivierung erzeugen, öffentlicher Teil kommt in die Lizenzdatei.\n- Export: Manifest mit licenseId, Projekt-ID, Version, SHA-256 aller Dateien, signiert mit dem Projektschlüssel\n- Zu jedem Player werden projekt.pkg und die aktuelle lizenz.lic übertragen'),
 ('Designer (offline): Player im lokalen Netz finden und veröffentlichen', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:designer', 'epic:betrieb'],
  'Netzwerk ist der Standardweg der Verteilung, USB nur als Ausnahme.\n- Player per mDNS/DNS-SD (_kioskplayer._tcp) finden, nur Player derselben licenseId anzeigen; manuelle Eingabe per IP/Hostname für Netze ohne Multicast\n- „Veröffentlichen“ mit Auswahl der Ziel-Player, Übertragung über HTTPS mit Prüfung des Zertifikat-Fingerprints\n- Status je Player: erreicht, übertragen, geprüft, läuft, Fehlercode\n- Designer auf dem Player-Rechner erlaubt, ohne Sonderrechte'),
 ('Player: Aktivierungsbildschirm, Online-Aktivierung und Abmelden mit Freigabecode', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:player'],
  'Ohne Lizenz: Maschinencode als Text und QR, Eingabe Lizenzschlüssel, Export geraet.id auf USB.\n- Online-Aktivierung über die API, Lizenzdatei lokal speichern\n- Im Wartungsmodus: Gerät abmelden, Lizenz löschen, Sperre merken, Freigabecode anzeigen'),
 ('Player: Netzwerkdienst für Deployment (mDNS, HTTPS, Paketannahme)', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:player', 'security'],
  'mDNS-Ankündigung mit licenseId, Maschinencode und serial.\n- HTTPS-Dienst (Standard-Port 8443, konfigurierbar), eigenes Zertifikat mit Fingerprint aus dem Maschinencode\n- Nur Pakete annehmen, deren Manifest mit dem Projektschlüssel der Lizenz signiert ist\n- Blockweise Übertragung mit Fortsetzung, Umschalten erst nach vollständiger Prüfung, altes Projekt läuft bis dahin\n- Firewall-Regel im Installer'),
 ('Player: Lizenzabgleich im Netz (serial-Austausch zwischen Playern)', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:player', 'security'],
  'Player tauschen beim Start und alle 10 Minuten ihre Lizenz-serial aus.\n- Höhere serial bei einem anderen Player derselben Lizenz: Lizenzdatei holen, Signatur prüfen, übernehmen\n- Steht das Gerät nicht mehr in der neuen Lizenz: sofort sperren (L03)\n- Getrennt gehaltene Geräte fängt weiterhin renewBefore ab'),
 ('Player: Startprüfung, Fehlercodes, Uhrzeitschutz, USB nur mit allowUsb', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'epic:player', 'security'],
  'Prüfung bei jedem Start und jedem neuen Projekt: Signatur der Lizenz, serial nicht kleiner als die höchste gesehene, Maschinencode in devices, validUntil/renewBefore, Manifest-Signatur, licenseId, Datei-Hashes.\n- Höchste serial und letzter Zeitpunkt geschützt und mehrfach gespeichert (DPAPI, TPM-NV falls vorhanden)\n- Uhr mehr als 48 h zurückgestellt: sperren bis Zeit plausibel\n- Fehlercodes L01-L07, P01-P02 mit Maschinencode in der Meldung; neutraler Bildschirm optional\n- Import vom USB-Stick nur, wenn allowUsb gesetzt ist'),
 ('Testplan Lizenzschutz (Szenarien vor Freigabe)', 'M5 Offline-Lizenzierung', ['epic:lizenz', 'doku', 'security'],
  'Szenarien: Hardwaretausch einzelner Komponenten, geklontes Image, VM, Uhr zurückgestellt, alte Lizenzdatei, manipulierte Lizenzdatei, verändertes Projekt, Projekt einer fremden Lizenz, mehrere Designer mit derselben Lizenz, Wechsel ohne Freigabecode über das Lease-Ende, getauschtes Gerät im selben Netz.'),
]

def md():
    out = ["# Plinth – Tickets\n"]
    for m, d in MILESTONES.items():
        out.append(f"\n## {m}\n_{d}_\n")
        for t, mm, labels, body in T:
            if mm == m:
                out.append(f"### {t}\n`{', '.join(labels)}`\n\n{body}\n")
    open("TICKETS.md", "w").write("\n".join(out))
    print(len(T), "Tickets ->", "TICKETS.md")

def sh(*a, **k):
    return subprocess.run(a, capture_output=True, text=True, **k)

def create(repo):
    for l in LABELS:
        sh("gh", "label", "create", l, "-R", repo, "--force")
    ms = {}
    r = sh("gh", "api", f"repos/{repo}/milestones?state=all&per_page=100", "--jq", ".[] | [.number,.title] | @tsv")
    for line in r.stdout.splitlines():
        n, t = line.split("\t", 1); ms[t] = int(n)
    for m, d in MILESTONES.items():
        if m not in ms:
            r = sh("gh", "api", f"repos/{repo}/milestones", "-f", f"title={m}", "-f", f"description={d}", "--jq", ".number")
            ms[m] = int(r.stdout.strip())
    done = set(sh("gh", "api", f"repos/{repo}/issues?state=all&per_page=100", "--paginate", "--jq", ".[].title").stdout.splitlines())
    for t, m, labels, body in T:
        if t in done:
            continue
        args = ["gh", "api", f"repos/{repo}/issues", "-f", f"title={t}", "-f", f"body={body}", "-F", f"milestone={ms[m]}"]
        for l in labels:
            args += ["-f", f"labels[]={l}"]
        args += ["--jq", ".html_url"]
        r = sh(*args)
        print(r.stdout.strip() or r.stderr.strip()[:200])

if __name__ == "__main__":
    if sys.argv[1] == "md": md()
    else: create(sys.argv[2])
