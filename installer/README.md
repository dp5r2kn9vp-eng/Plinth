# Installer (Windows)

Inno-Setup-Skript `plinth.iss` für den Plinth Player.

- Installiert nach `C:\Program Files\Plinth`, legt `C:\ProgramData\Plinth` an (für Benutzer beschreibbar)
- Autostart für alle Benutzer: `Plinth.exe --watchdog` (HKLM\…\Run)
- **Kiosk-Einstellungen** (standardmäßig an): Bildschirm/PC schlafen nie, Ruhezustand aus, Windows-Update-Nutzungszeit 6–23 Uhr, Kantenwischen aus
- Firewall-Freigabe für den Offline-Empfang (TCP 47800, UDP 47801), bei Deinstallation entfernt
- Ohne Parameter startet der Player im **Offline-Betrieb** und richtet sich selbst ein ([`docs/offline.md`](../docs/offline.md))
- Beendet laufende Player vor Update und Deinstallation
- Deinstallation entfernt Programm, Autostart und Daten (Medien, Token, Protokolle)

## Stille Installation (Rollout)

```bat
PlinthSetup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="kiosk" ^
  /KUNDENCODE=ABCD-EFGH-JKMN /PIN=4711 /APIURL=https://plinth.example.de/api /NAME="Foyer links"
```

Mit `/KUNDENCODE` und `/PIN` legt der Installer `provision.json` ab; der Player richtet sich beim ersten Start selbst ein und löscht die Datei. `/NAME` (Standard: Computername) und `/APIURL` sind optional. Ohne diese Parameter fragt der Player beim ersten Start.

Bei stiller Installation startet der Player beim nächsten Anmelden (Autostart), bei interaktiver Installation sofort.

```bat
"C:\Program Files\Plinth\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

## Bauen

```bash
cd player && npm ci && npm run dist:win     # → player/dist/win-unpacked
iscc /DAppVersion=1.0.0 installer\plinth.iss # → dist/PlinthSetup-1.0.0.exe
```

Die CI (`.github/workflows/windows.yml`) baut beides auf Windows und prüft den Installer mit `test-installer.ps1`. Code-Signing folgt mit #36 (M2); bis dahin zeigt Windows SmartScreen beim ersten Start eine Warnung.
