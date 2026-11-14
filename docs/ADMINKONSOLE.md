# Plinth Admin-Konsole (Betreiber, Kunden, Speicher, Abrechnung)

Stand 14.11.2026. Plan für die Betreiberoberfläche. Vorbild ist die Betreiberkonsole von Crewvado (`admin/`, `routes/operator.php`), Abrechnung nach dem Crewvado-Muster (eigene Rechnungen, Stripe nur als Zahlungsweg). Tickets: Meilenstein **M4 Betreiber & Abrechnung** in `docs/tickets/`.

## Entscheidungen

| Thema | Entscheidung (Nutzer, 14.11.2026) |
|---|---|
| Technik | Admin-Konsole ist eine **eigene Laravel-App** (`/admin`), gleiche Datenbank wie die API. Die API bleibt reines PHP (bereits gebaut, #43–#51). |
| Preise | **Netto** zzgl. USt (B2B). |
| Preisvorschläge | Jahresrabatt, Staffel, Wartung, Speicher, Testphase wie unten: **bestätigt**. |
| Einmal-Kauf und Cloud | Einmal-Kauf ohne unseren Medienspeicher; Cloud als Zusatz-Abo: **bestätigt**. |
| Android | Entfällt (Player nur Windows). |

Vom Agenten entschieden (begründet, änderbar):

- **Kein Stripe Billing.** Rechnungen (lückenlose Nummern, PDF, ZUGFeRD/XRechnung) erzeugt die Konsole selbst, Stripe zieht nur ein (Karte, SEPA-Lastschrift; SetupIntent + Off-Session-PaymentIntent). Grund: gleiche Abrechnung wie Crewvado, E-Rechnung und Nummernkreis in eigener Hand.
- **Kein Lizenzschlüssel.** Jeder Player registriert sich über den Kundencode bei der API; dort wird die Geräteanzahl geprüft. Ein offline prüfbarer Schlüssel bringt keinen Mehrwert.
- **Zahlungsverzug stoppt nie die Wiedergabe.** Gesperrt werden Uploads und Veröffentlichen im Studio, die Player spielen den letzten Stand weiter. Erst Kündigung oder Laufzeitende widerruft Geräte-Tokens.
- **Eigener Speicher beim Einmal-Kauf = eigener S3-kompatibler Bucket** des Kunden (vorhandener S3-Treiber, Zugangsdaten verschlüsselt je Kunde). FTP als Medienquelle später, falls gefragt.

## Preismodell (netto)

| Produkt | Preis | Enthalten |
|---|---|---|
| Abonnement, monatlich | 39,95 € je Player und Monat | Updates & Support, Cloud-Veröffentlichung (DE/EU), Studio von beliebig vielen PCs, 10 GB Speicher je Lizenz |
| Abonnement, jährlich | 399,50 € je Player und Jahr (10 zahlen, 12 nutzen) | wie monatlich |
| Einmal-Kauf Windows | 599,95 € je Player | dauerhafte Lizenz, Updates & Support 1 Jahr ab Kauf, Studio, Veröffentlichung in eigenen S3-Bucket |
| Staffel Einmal-Kauf | ab 5: 539,95 € · ab 10: 509,95 € · ab 25: 479,95 € | Staffel gilt für die ganze Bestellung |
| Wartung nach Jahr 1 | 119,95 € je Lizenz und Jahr | Updates & Support |
| Cloud-Zusatz für Einmal-Kauf | 9,95 € je Player und Monat | Cloud-Veröffentlichung, 10 GB je Player |
| Zusatzspeicher | 9,95 € je 50 GB und Monat | |
| Plugins | Einmalpreis je Plugin und Kunde | gilt für alle Lizenzen des Kunden |
| Testphase | kostenlos, 14 Tage | 1 Player, 5 GB |

Regeln:

- Preise mit Gültigkeitsdatum im Katalog. Rechnungen frieren den Preis ein; Änderungen wirken ab der nächsten Laufzeit.
- **Mehr Lizenzen** mitten in der Laufzeit: anteilig (taggenau) bis zum gemeinsamen Laufzeitende. **Weniger Lizenzen / Kündigung:** zum Laufzeitende. Mindestlaufzeit 1 Monat bzw. 1 Jahr.
- USt nach Crewvado-Logik (`InvoiceIssuer::tax`): 19 % im Inland, Reverse Charge bei EU-Unternehmen mit geprüfter USt-IdNr.
- Zahlarten: Karte, SEPA-Lastschrift; **auf Rechnung** nur nach Freischaltung je Kunde durch den Betreiber.
- Wartung abgelaufen: Player bekommt keine Auto-Updates mehr nach dem Wartungsende, läuft aber weiter.

## Architektur

```
plinth.klangniveau.de          admin.plinth.klangniveau.de
 ├─ /studio  (Web, Kunde)       └─ Laravel-App (Betreiber)
 ├─ /api     (reines PHP)            ├─ eigener Login + TOTP
 └─ Player   (Electron)              ├─ Abrechnung, Stripe, Rechnungen
        │                            └─ Cron (Abo-Lauf, Mahnwesen, Speicher)
        └──────────── gemeinsame MySQL/MariaDB ────────────┘
```

**Tabellenhoheit**

- Kerntabellen (`kunden`, `benutzer`, `geraete`, `dateien`, `revisionen` …) gehören der API, Migrationen bleiben in `api/migrations/*.sql`. Neue Felder dort hinzufügen, auch wenn nur die Konsole sie schreibt.
- Abrechnungs- und Betreibertabellen gehören der Admin-App (Laravel-Migrationen, Präfix `adm_`). Die API liest sie nie.
- Die Konsole schreibt in Kerntabellen **nur** diese Felder: `kunden.status`, `kunden.test_bis`, `kunden.max_geraete`, `kunden.speicher_kontingent_bytes`, `kunden.studio_gesperrt`, `kunden.sperr_grund`, `kunden.speicher_ziel`, `geraete.gesperrt`. So bleibt die Durchsetzung in der API einfach und unabhängig von Laravel.

**Neue Felder in `kunden` (API-Migration):** `status` (`test`, `aktiv`, `verzug`, `gesperrt`, `gekuendigt`), `test_bis`, `max_geraete`, `speicher_kontingent_bytes`, `studio_gesperrt`, `sperr_grund`, `speicher_ziel` (`cloud` oder `eigen`), `kundennummer`.

**Durchsetzung in der API**

- Geräteregistrierung: aktive, nicht gesperrte Geräte < `max_geraete`, sonst klare Meldung im Player-Setup.
- Upload-Init: Summe `dateien.groesse` (Status `fertig` + laufende Uploads) + neue Datei ≤ Kontingent; ab 80 % Hinweis im Studio.
- `studio_gesperrt`: Upload und Veröffentlichen abgelehnt (Hinweis „Bitte offene Rechnung begleichen“), Lesen erlaubt. Player-API unverändert.
- `gekuendigt` nach Laufzeitende: Login gesperrt, Geräte-Tokens ungültig.

**Neue Tabellen der Admin-App (`adm_`)**

`betreiber` (mit TOTP), `verlauf` (Betreiber, Zeit, Kunde, Aktion, vorher/nachher, Begründung, verschlüsselt), `preise` (versioniert), `vertraege` (Abo/Kauf/Cloud-Zusatz/Speicher, Intervall, Anzahl, Preis-Snapshot, Laufzeit, gekündigt zum), `kauf_lizenzen` (Anzahl, gekauft am, Wartung bis), `plugins`, `kunden_plugins`, `freischaltungen` (kostenlos, Enddatum, Begründung), `rechnungsprofile`, `zahlarten` (nur Marke + letzte 4), `rechnungen`, `rechnungspositionen`, `zahlungen`, `mahnstufen`, `speicher_messungen` (täglich je Kunde), `speicher_abgleich` (nächtlicher Bucket-Abgleich), `rechnungssteller`.

## Menü der Konsole

1. **Dashboard:** MRR, aktive Lizenzen (Abo/Kauf), Player online/offline, Speicher gesamt vs. Bucket, überfällige Rechnungen, Cron-Status.
2. **Kunden:** Liste mit Statusfilter (Test, aktiv, Verzug, gesperrt, gekündigt). Kundenakte mit Reitern:
   - Übersicht (Stammdaten, Kundencode, Status)
   - Lizenzen & Plugins (Verträge, Laufzeit, Wartung, kostenlose Freischaltung mit Enddatum + Begründung)
   - Geräte (Name, Version, letzter Heartbeat, Revision; sperren, entfernen)
   - Speicher (Verbrauch/Kontingent, größte Dateien, Verlauf 90 Tage, Speicherziel)
   - Benutzer (Studio-Zugänge, Einladung neu senden)
   - Abrechnung (Rechnungen, Zahlarten, „auf Rechnung“ freischalten, Zahlung buchen, Gutschrift/Storno)
   - Verlauf
   Jede Änderung mit Begründung und Bestätigung, doppelte Absendung ohne Wirkung (wie Crewvado).
3. **Geräte (alle):** Filter offline > 1 h, veraltete Version, gesperrt.
4. **Speicher:** Verbrauch je Kunde, Bucket-Abgleich (verwaiste Objekte, abgebrochene Multipart-Uploads, Abweichung DB ↔ Bucket), geschätzte Anbieterkosten.
5. **Abrechnung:** Rechnungen, offen/überfällig, Monatsabschluss (ZIP: PDFs, Übersicht, CSV, XLSX), Stripe-Gebühren.
6. **Preise & Produkte:** Lizenzarten, Staffel, Plugins, Speicherpakete, Gültigkeit.
7. **Einstellungen:** Rechnungssteller, Mail und Vorlagen, Player-Update-Kanal, Betreiber & 2FA.
8. **Monitoring & Audit.**

## Übernahme aus Crewvado (anpassen, nicht neu erfinden)

| Crewvado | Plinth |
|---|---|
| `OperatorSurface`, `OperatorSession`, `OperatorLoginService`, `OperatorTotp`, `OperatorEnrollment` | Login, 2FA, Einrichtung |
| `CompanyAdminChange` / Verlauf der Kundenakte | `adm_verlauf` |
| `Pool/InvoiceIssuer`, `EInvoice/*`, `Pdf/EmbedsEInvoice`, `InvoiceSettingsController` | Rechnungssteller, Rechnungen, E-Rechnung |
| `Pool/StripeClient`, `StripeConfig`, `CompanyBillingService` | Zahlarten, Einzug |
| `PaymentDunningService`, `OperatorBillingOverview` | Mahnwesen Tag 1 / 7 / 14 → `studio_gesperrt` statt Modulsperre |
| `Pool/MonthlyClosing`, `OperatorStripeFeeController` | Monatsabschluss, Gebühren |
| `OperatorStorageService`, `OperatorMonitoring` | Speicher, Monitoring |
| `Cron/CronDispatcher` | Abo-Lauf, Mahnwesen, Messung, Abgleich (Webcron für ALL-INKL) |

## Abläufe

**Abo-Lauf (täglich, Europe/Berlin):** Verträge mit Laufzeitbeginn heute → Rechnung ausstellen → bei Karte/SEPA Einzug per Stripe (Idempotenzschlüssel je Rechnung), bei „auf Rechnung“ Versand mit 14 Tagen Ziel. Fehlgeschlagener Einzug → offene Rechnung → Mahnwesen.

**Mahnwesen:** Tag 1 Hinweis im Studio, Tag 7 Erinnerung (Mail), Tag 14 `studio_gesperrt`. Zahlung oder Betreiberfreigabe (Begründung) hebt sofort auf. Testphase und kostenlose Freischaltungen nie betroffen.

**Testphase:** Kunde mit `status = test`, 1 Gerät, 5 GB. Ablauf → Studio gesperrt, Player zeigt den Stand weiter bis 7 Tage nach Ablauf, dann Token ungültig. Übernahme als Kunde behält alle Daten.

**Speicher:** Nächtlich je Kunde Summe aus `dateien` in `adm_speicher_messungen`; wöchentlich Bucket-Liste gegen DB (Abgleich, keine automatische Löschung, Betreiber entscheidet).

## Umsetzungsreihenfolge (M4)

1. Admin-App Grundgerüst, Login + 2FA, Verlauf
2. API-Migration Kundenstatus und Durchsetzung (Gerätelimit, Kontingent, Studio-Sperre)
3. Kunden und Kundenakte (anlegen, Test, sperren, Kundencode)
4. Geräteübersicht
5. Speicher: Messung, Kontingent, Abgleich
6. Preiskatalog und Verträge
7. Rechnungssteller, Rechnungen, E-Rechnung
8. Zahlarten (Stripe) und Freischaltung „auf Rechnung“
9. Abo-Lauf (monatlich/jährlich, anteilig, Kündigung)
10. Mahnwesen
11. Einmal-Kauf, Wartung, Cloud-Zusatz, eigener Bucket
12. Plugins
13. Monatsabschluss und Stripe-Gebühren
14. Dashboard und Monitoring
15. Studio: Abrechnungsseite für Kunden (Rechnungsdaten, Zahlarten, Rechnungen, Lizenzen dazubuchen)

Abhängigkeiten: 2 braucht die M1-API (#43, #45, #46). 7–10 können parallel zu M1/M2 entstehen. 11 braucht den S3-Treiber je Kunde.
