# Kiosk-Einrichtung (Windows 10/11)

Empfehlung für dedizierte Bildschirm-PCs. Der Installer erledigt die mit ✓ markierten Punkte, wenn die Option „Kiosk-Einstellungen“ gewählt ist (siehe `installer/`).

## 1. Eigenes Konto mit automatischer Anmeldung

- Lokales Standardkonto anlegen, z. B. `plinth` (kein Administrator).
- Automatische Anmeldung: `netplwiz` → Häkchen „Benutzer müssen Benutzernamen und Kennwort eingeben“ entfernen. Ist die Option ausgeblendet: Registry `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device` → `DevicePasswordLessBuildVersion` = `0`. Alternativ Sysinternals **Autologon** (speichert das Kennwort verschlüsselt).

## 2. Plinth als einzige App (optional, empfohlen)

- **Windows 11 Pro/Enterprise/Education:** *Einstellungen → Konten → Andere Benutzer → Kiosk einrichten* ist für UWP gedacht. Für Plinth (Desktop-App) **Shell Launcher v2** (Enterprise/Education) oder eine **Assigned-Access-Konfiguration** mit Desktop-App nutzen; Plinth wird dann statt Explorer gestartet: `"C:\Program Files\Plinth\Plinth.exe" --watchdog`.
- Ohne Shell Launcher: Autostart durch den Installer genügt; der Player läuft im Kiosk-Vollbild, Alt+F4 ist wirkungslos, der Watchdog startet nach Beenden neu.
- Für den **Wartungsmodus** („Windows nutzen“) muss Explorer verfügbar sein. Bei Shell Launcher daher für das Administratorkonto die normale Shell belassen und Wartung mit diesem Konto durchführen.

## 3. Energie ✓

Bildschirm und PC dürfen nicht schlafen gehen:

```bat
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
```

Zusätzlich verhindert der Player selbst das Abschalten des Displays, solange er läuft.

## 4. Windows-Update-Zeiten ✓

Updates und Neustarts in die Nacht legen (Nutzungszeit 6–23 Uhr):

```bat
reg add "HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" /v ActiveHoursStart /t REG_DWORD /d 6 /f
reg add "HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" /v ActiveHoursEnd /t REG_DWORD /d 23 /f
```

Nach einem Neustart meldet sich das Konto automatisch an, der Autostart startet den Watchdog, der Player zeigt sofort den lokal gespeicherten Stand.

## 5. Sonstiges

- Benachrichtigungen aus (Fokus-Assistent / „Nicht stören“), damit nichts über den Inhalt gelegt wird.
- Bildschirmschoner aus.
- Touch: Kantenwischen deaktivieren, damit Benutzer nicht ins Info-Center gelangen: `reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v AllowEdgeSwipe /t REG_DWORD /d 0 /f` ✓
- Festplattenplatz: der Player behält Medien der aktuellen und der vorigen Revision. Bei großen Videos genügend Platz einplanen (≥ 2× Gesamtgröße).
