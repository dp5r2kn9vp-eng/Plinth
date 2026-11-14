# Prüft den Installer auf einem echten Windows (CI oder Testrechner, als Administrator):
# stille Installation mit Provisionierung, Dateien, Rechte, Autostart, Kiosk-Einstellungen,
# Start über den Watchdog inkl. Neustart nach Absturz, Update bei laufendem Player, Deinstallation.
param([Parameter(Mandatory)] [string] $Setup)
$ErrorActionPreference = 'Stop'

function Check([bool] $ok, [string] $msg) {
  if (-not $ok) { throw "FEHLER: $msg" }
  Write-Host "OK   $msg"
}
function WaitFor([scriptblock] $cond, [int] $seconds = 60) {
  for ($i = 0; $i -lt $seconds; $i++) { if (& $cond) { return $true }; Start-Sleep 1 }
  return $false
}
function LogText() { if (Test-Path $log) { Get-Content $log -Raw -Encoding UTF8 } else { '' } }
function Count([string] $pattern) { ([regex]::Matches((LogText), $pattern)).Count }
function LastPid() {
  $m = [regex]::Matches((LogText), 'Player gestartet \{"version":"[^"]+","pid":(\d+)')
  if ($m.Count -eq 0) { return 0 }; [int] $m[$m.Count - 1].Groups[1].Value
}

$Setup = (Resolve-Path $Setup).Path
$app = Join-Path $env:ProgramFiles 'Plinth'
$data = Join-Path $env:ProgramData 'Plinth'
$log = Join-Path $data 'logs\player.log'
$runKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'

Write-Host "== Stille Installation mit Provisionierung"
$p = Start-Process $Setup -Wait -PassThru -ArgumentList @(
  '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TASKS=kiosk', '/LOG=install.log',
  '/KUNDENCODE=TEST-TEST-TEST', '/PIN=1357', '/APIURL=http://127.0.0.1:9/api', '/NAME="Prüfgerät Süd"')
Check ($p.ExitCode -eq 0) "Installer beendet mit Exit-Code 0"
Check (Test-Path "$app\Plinth.exe") "Plinth.exe in Program Files"
Check (Test-Path "$app\resources\shared\renderer\runtime.js") "Gemeinsamer Renderer enthalten"
Check (Test-Path "$app\unins000.exe") "Deinstallationsprogramm vorhanden"
$run = (Get-ItemProperty $runKey).PlinthPlayer
Check ($run -eq "`"$app\Plinth.exe`" --watchdog") "Autostart: $run"
$prov = Get-Content "$data\provision.json" -Raw -Encoding UTF8 | ConvertFrom-Json
Check ($prov.kundencode -eq 'TEST-TEST-TEST' -and $prov.pin -eq '1357' -and $prov.apiUrl -eq 'http://127.0.0.1:9/api') "provision.json mit Code, PIN, Server"
Check ($prov.name -eq 'Prüfgerät Süd') "provision.json: Umlaute erhalten (UTF-8)"
$acl = (Get-Acl $data).Access | Where-Object { $_.IdentityReference -match 'Users|Benutzer' -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) -eq [Security.AccessControl.FileSystemRights]::Modify }
Check ($null -ne $acl) "ProgramData\Plinth für Benutzer beschreibbar"
$wu = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
Check ($wu.ActiveHoursStart -eq 6 -and $wu.ActiveHoursEnd -eq 23) "Kiosk: Update-Nutzungszeit 6–23 Uhr"
Check ((Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI').AllowEdgeSwipe -eq 0) "Kiosk: Kantenwischen aus"

Write-Host "== Start über den Watchdog"
$env:PLINTH_WINDOWED = '1'
Start-Process "$app\Plinth.exe" -ArgumentList '--watchdog'
Check (WaitFor { (Count 'Player gestartet') -ge 1 }) "Watchdog startet den Player"
Check ((Count 'Watchdog gestartet') -ge 1) "Watchdog läuft"
Check (WaitFor { (Count 'Automatische Einrichtung') -ge 1 }) "Zero-Touch-Einrichtung wird versucht"
Check (WaitFor { (Count 'Automatische Einrichtung fehlgeschlagen') -ge 1 }) "Server nicht erreichbar wird protokolliert"
Check (Test-Path "$data\provision.json") "provision.json bleibt für den nächsten Versuch erhalten"

Write-Host "== Absturz des Players"
Stop-Process -Id (LastPid) -Force
Check (WaitFor { (Count 'Player beendet') -ge 1 }) "Watchdog bemerkt das Ende"
Check (WaitFor { (Count 'Player gestartet') -ge 2 }) "Watchdog startet neu"

Write-Host "== Update-Installation bei laufendem Player"
$p = Start-Process $Setup -Wait -PassThru -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/LOG=install-update.log'
Check ($p.ExitCode -eq 0) "Erneute Installation erfolgreich"
Check (Test-Path "$app\Plinth.exe") "Programm nach Update vorhanden"
Check (Test-Path "$data\logs\player.log") "Daten bleiben beim Update erhalten"

Write-Host "== Deinstallation bei laufendem Player"
Start-Process "$app\Plinth.exe" -ArgumentList '--watchdog'
Check (WaitFor { (Count 'Player gestartet') -ge 3 }) "Player läuft vor der Deinstallation"
Start-Process "$app\unins000.exe" -Wait -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'
Check (WaitFor { -not (Test-Path "$app\Plinth.exe") } 120) "Programmdateien entfernt"
Check (WaitFor { -not (Test-Path $data) } 30) "Datenordner entfernt"
Check ($null -eq (Get-ItemProperty $runKey).PlinthPlayer) "Autostart-Eintrag entfernt"
Check ($null -eq (Get-Process Plinth -ErrorAction SilentlyContinue)) "Keine Plinth-Prozesse mehr"
Write-Host "Alle Installer-Prüfungen bestanden."
