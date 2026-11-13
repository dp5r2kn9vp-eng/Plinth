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
}
LABELS = ["epic:architektur", "epic:designer", "epic:player", "epic:installer",
          "epic:storage", "epic:betrieb", "epic:cloud", "security", "doku"]

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
  "Admin-Oberfläche für dich als Betreiber."),
 ("Download-Zeitfenster & Bandbreitenbegrenzung für Player", "M3 Cloud", ["epic:betrieb"],
  "Große Updates nachts laden, Bandbreite begrenzen."),
 ("Datenschutz & Betrieb (AVV, Backups, Monitoring)", "M3 Cloud", ["doku", "security"],
  "EU-Hosting, Auftragsverarbeitung, Backups der Datenbank, Monitoring."),
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
