# Abnahme beim ersten Kunden (2 Player)

Vorlage zum Ausdrucken bzw. Abhaken vor Ort. Pro Gerät ausfüllen. Ergebnis und Abweichungen am Ende festhalten.

**Kunde:** ______________________ **Datum:** __________ **Durchgeführt von:** ______________________

| | Gerät 1 | Gerät 2 |
|---|---|---|
| Standort / Name | | |
| Windows-Version | | |
| Bildschirm (Auflösung, Ausrichtung, Touch?) | | |
| Netzwerk (LAN/WLAN, Proxy?) | | |

## Vorbereitung (Büro)

- [ ] Server eingerichtet: `.env`, `php bin/migrate.php`, Cronjob `bin/verify-files.php`, `php bin/s3-setup.php`
- [ ] Kunde und Benutzer angelegt (`bin/create-user.php`), Anmeldung im Studio klappt
- [ ] `php bin/upload-smoke.php --gb=2` gegen die echte Installation erfolgreich
- [ ] Inhalte mit echten Videos des Kunden gestaltet und veröffentlicht (Revision 1)
- [ ] Installer `PlinthSetup-x.y.z.exe` aus dem GitHub-Release, Kundencode notiert

## 1. Installation

- [ ] Installer als Administrator ausführen, Option „Kiosk-Einstellungen“ gewählt
- [ ] Auto-Login für das Kiosk-Konto eingerichtet (`docs/kiosk-einrichtung.md`)
- [ ] Nach Neustart startet Plinth automatisch im Vollbild

## 2. Code-Eingabe

- [ ] Falscher Code → verständliche Meldung
- [ ] Richtiger Code, Gerätename, PIN → Gerät erscheint im Studio unter „Geräte“ (online)
- [ ] Mauszeiger ausgeblendet (bzw. wie gewünscht)

## 3. Sync großer Videos

- [ ] Ladefortschritt sichtbar, Inhalte erscheinen nach vollständigem Download
- [ ] Studio zeigt „Stand“ = aktuelle Revision
- [ ] Dauer für ____ GB: ______ min (Leitung: ______ Mbit/s)
- [ ] Netzwerkkabel während des Downloads ziehen und wieder stecken → Download läuft weiter (Fortsetzen)

## 4. Bedienung (Touch)

- [ ] Thumbnail antippen → Video startet mit Ton, Kopfzeile mit Zurück-Button
- [ ] Zurück-Button → Startseite
- [ ] Video bis zum Ende → automatisch zurück
- [ ] Weitere Seiten / Buttons wie gestaltet
- [ ] Nach ____ s ohne Bedienung zurück zur Startseite
- [ ] Kantenwischen öffnet nichts, Alt+F4 beendet nicht

## 5. Offline

- [ ] Netzwerk trennen → Inhalte laufen weiter, kleiner gelber Punkt unten rechts
- [ ] PC neu starten ohne Netzwerk → Inhalte erscheinen trotzdem
- [ ] Netzwerk wieder verbinden → Punkt verschwindet

## 6. Neustart & Robustheit

- [ ] PC hart ausschalten und wieder einschalten → startet selbstständig mit Inhalten
- [ ] Im Task-Manager `Plinth.exe` (Player) beenden → nach wenigen Sekunden wieder da

## 7. Update einer Revision

- [ ] Im Studio etwas ändern (Text, neues Video) und veröffentlichen
- [ ] Beide Player zeigen die Änderung nach ≤ 1–2 min, ohne Unterbrechung eines laufenden Videos
- [ ] Studio: beide Geräte auf der neuen Revision

## 8. Wartung

- [ ] Strg+Alt+Umschalt+K bzw. 5× oben links tippen → PIN-Feld
- [ ] Falsche PIN → kein Hinweis; richtige PIN → Menü
- [ ] „Windows nutzen 15 Minuten“ → Desktop nutzbar, danach automatisch zurück
- [ ] „Player beenden“ → bleibt aus bis zum Neustart bzw. manuellem Start
- [ ] „Status & Protokoll“ zeigt Revision, Online-Status, Protokoll

## 9. Sperren

- [ ] Gerät im Studio sperren → „Gerät gesperrt“; entsperren → Inhalte wieder da

## Ergebnis

- [ ] **Abgenommen**   - [ ] Abgenommen mit Auflagen   - [ ] Nicht abgenommen

Abweichungen / offene Punkte:

____________________________________________________________________________

Unterschrift Kunde: ______________________   Unterschrift Plinth: ______________________
