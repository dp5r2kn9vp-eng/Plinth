# Plinth

Digital-Signage-System für Windows-Kiosk-Displays.

- **Plinth Studio** (`/studio`): webbasierter Designer, Layouts frei positionieren, Medien hochladen, veröffentlichen
- **Plinth Player** (`/player`): Windows-App, holt sich Veröffentlichungen und spielt sie lokal ab (offlinefähig)
- **API** (`/api`): PHP-Backend (Login, Kunden, Geräte, Revisionen, signierte Speicher-Links)
- **Speicher**: S3-kompatibler Cloud-Speicher (privat), Dateien laufen nie durch PHP
- **Schemas** (`/shared`): Manifest- und Layout-Format
- **Installer** (`/installer`): Windows-Installer für den Player

Aufgaben: siehe GitHub Issues und Meilensteine (M1 MVP, M2 Betrieb, M3 Cloud).
Ticketquelle: `docs/tickets/`.

## Dokumentation

| Thema | Datei |
|---|---|
| Architektur und Entscheidungen | [`docs/architektur.md`](docs/architektur.md) |
| Layout- und Manifest-Format | [`shared/README.md`](shared/README.md) |
| API (Einrichtung, Endpunkte, Sicherheit) | [`api/README.md`](api/README.md) |
| Studio | [`studio/README.md`](studio/README.md) |
| Player | [`player/README.md`](player/README.md) |
| Installer und Rollout | [`installer/README.md`](installer/README.md) |
| Kiosk-Einrichtung Windows | [`docs/kiosk-einrichtung.md`](docs/kiosk-einrichtung.md) |
| Entwicklung, Tests, CI, Release | [`docs/entwicklung.md`](docs/entwicklung.md) |
| Abnahme-Checkliste | [`docs/abnahme-checkliste.md`](docs/abnahme-checkliste.md) |

## Konfiguration
Zugangsdaten gehören nur in die `.env` auf dem Server, nie ins Repository. Vorlage: `.env.example`.
