; Plinth Player – Windows-Installer (Inno Setup 6)
;
; Bauen (nach "npm run dist:win" in player/):
;   iscc /DAppVersion=1.0.0 installer\plinth.iss
;
; Stille Installation für den Rollout:
;   PlinthSetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /TASKS="kiosk" ^
;     /KUNDENCODE=ABCD-EFGH-JKMN /PIN=4711 /APIURL=https://plinth.example.de/api /NAME="Foyer links"
;   /KUNDENCODE und /PIN legen provision.json ab: der Player richtet sich beim ersten Start selbst ein.
;   /NAME ist optional (Standard: Computername), /APIURL optional (Standard aus dem Player).
;
;   Ohne /KUNDENCODE startet der Player im Offline-Betrieb: keine Eingabe nötig, Kopplung aus Plinth Studio.
;
; Stille Deinstallation:
;   "C:\Program Files\Plinth\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\player\dist\win-unpacked"
#endif

[Setup]
AppId={{5CC17A29-5C30-42BA-92E6-524E5843F8DC}
AppName=Plinth Player
AppVersion={#AppVersion}
AppVerName=Plinth Player {#AppVersion}
AppPublisher=Plinth
DefaultDirName={autopf}\Plinth
DefaultGroupName=Plinth
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=PlinthSetup-{#AppVersion}
SetupIconFile=..\player\build\icon.ico
UninstallDisplayIcon={app}\Plinth.exe
UninstallDisplayName=Plinth Player
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
MinVersion=10.0

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
; Standardmäßig aktiv: der Player soll ohne Nacharbeit als Kiosk laufen (auch bei stiller Installation ohne /TASKS)
Name: "kiosk"; Description: "Kiosk-Einstellungen: kein Energiesparen, Updates nachts, kein Kantenwischen"

[Dirs]
; Datenordner für alle Benutzer beschreibbar (Player läuft im Konto mit Auto-Login, nicht als Administrator)
Name: "{commonappdata}\Plinth"; Permissions: users-modify

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Plinth Player"; Filename: "{app}\Plinth.exe"; Parameters: "--watchdog"
Name: "{group}\Plinth Player deinstallieren"; Filename: "{uninstallexe}"

[Registry]
; Autostart für alle Benutzer: der Watchdog startet und überwacht den Player
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "PlinthPlayer"; ValueData: """{app}\Plinth.exe"" --watchdog"; Flags: uninsdeletevalue
; Kiosk: Windows-Update-Nutzungszeit 6–23 Uhr, Kantenwischen aus
Root: HKLM; Subkey: "SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"; ValueType: dword; ValueName: "ActiveHoursStart"; ValueData: 6; Tasks: kiosk
Root: HKLM; Subkey: "SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"; ValueType: dword; ValueName: "ActiveHoursEnd"; ValueData: 23; Tasks: kiosk
Root: HKLM; Subkey: "SOFTWARE\Policies\Microsoft\Windows\EdgeUI"; ValueType: dword; ValueName: "AllowEdgeSwipe"; ValueData: 0; Tasks: kiosk

[Run]
; Kiosk: Bildschirm und PC schlafen nie
Filename: "{sys}\powercfg.exe"; Parameters: "/change monitor-timeout-ac 0"; Flags: runhidden; Tasks: kiosk
Filename: "{sys}\powercfg.exe"; Parameters: "/change standby-timeout-ac 0"; Flags: runhidden; Tasks: kiosk
Filename: "{sys}\powercfg.exe"; Parameters: "/change hibernate-timeout-ac 0"; Flags: runhidden; Tasks: kiosk
Filename: "{sys}\powercfg.exe"; Parameters: "/hibernate off"; Flags: runhidden; Tasks: kiosk
; Firewall: Offline-Empfang (TCP 47800) und Suche im Netz (UDP 47801) für Plinth Studio freigeben.
; Ohne diese Regeln fragt Windows beim ersten Start per Dialog nach – im Kiosk unerwünscht.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Plinth Player (Offline)"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Plinth Player (Offline)"" dir=in action=allow program=""{app}\Plinth.exe"" protocol=TCP localport=47800 profile=any enable=yes"; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Plinth Player (Offline)"" dir=in action=allow program=""{app}\Plinth.exe"" protocol=UDP localport=47801 profile=any enable=yes"; Flags: runhidden
; Nach interaktiver Installation direkt starten (bei stiller Installation startet der Autostart beim nächsten Anmelden)
Filename: "{app}\Plinth.exe"; Parameters: "--watchdog"; Description: "Plinth Player jetzt starten"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM Plinth.exe"; Flags: runhidden; RunOnceId: "KillPlinth"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Plinth Player (Offline)"""; Flags: runhidden; RunOnceId: "FirewallPlinth"

[UninstallDelete]
; Saubere Deinstallation: Daten, Medien, Token, Protokolle
Type: filesandordirs; Name: "{commonappdata}\Plinth"

[Code]
function ParamValue(const Name: String): String;
var
  I: Integer;
  P: String;
begin
  Result := '';
  for I := 1 to ParamCount do
  begin
    P := ParamStr(I);
    if CompareText(Copy(P, 1, Length(Name) + 2), '/' + Name + '=') = 0 then
    begin
      Result := Copy(P, Length(Name) + 3, MaxInt);
      Exit;
    end;
  end;
end;

{ JSON-String sicher maskieren }
function JsonStr(const S: String): String;
var
  I: Integer;
  C: Char;
begin
  Result := '"';
  for I := 1 to Length(S) do
  begin
    C := S[I];
    if C = '"' then Result := Result + '\"'
    else if C = '\' then Result := Result + '\\'
    else if Ord(C) < 32 then Result := Result + ' '
    else Result := Result + C;
  end;
  Result := Result + '"';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  { Laufenden Player (und Watchdog) vor Update beenden }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM Plinth.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code, Pin, Api, Name, Json: String;
  Lines: TArrayOfString;
begin
  if CurStep <> ssPostInstall then Exit;
  Code := ParamValue('KUNDENCODE');
  Pin := ParamValue('PIN');
  if (Code = '') or (Pin = '') then Exit;
  Api := ParamValue('APIURL');
  Name := ParamValue('NAME');
  Json := '{ "kundencode": ' + JsonStr(Code) + ', "pin": ' + JsonStr(Pin);
  if Api <> '' then Json := Json + ', "apiUrl": ' + JsonStr(Api);
  if Name <> '' then Json := Json + ', "name": ' + JsonStr(Name);
  Json := Json + ' }';
  SetArrayLength(Lines, 1);
  Lines[0] := Json;
  { UTF-8, damit Umlaute im Gerätenamen erhalten bleiben }
  SaveStringsToUTF8File(ExpandConstant('{commonappdata}\Plinth\provision.json'), Lines, False);
  Log('provision.json geschrieben');
end;
