# Plinth

Digital-Signage-System für Kiosk-Displays – mit Cloud oder ganz ohne Server (Offline-Betrieb).

- **Plinth Studio** (`/studio`): webbasierter Designer, Layouts frei positionieren, Medien hochladen, veröffentlichen
- **Plinth Studio Desktop** (`/studio-desktop`): derselbe Designer als Programm für Windows und macOS, ohne Server; veröffentlicht direkt an Player im lokalen Netz
- **Plinth Player** (`/player`): Windows-App, holt sich Veröffentlichungen aus der Cloud oder nimmt sie im lokalen Netz vom Studio an und spielt sie lokal ab; richtet sich nach der Installation selbst ein (Android folgt)
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
| **Offline-Betrieb** (Studio Desktop, Kopplung, Protokoll) | [`docs/offline.md`](docs/offline.md) |
| Studio Desktop (Windows, macOS) | [`studio-desktop/README.md`](studio-desktop/README.md) |
| Player | [`player/README.md`](player/README.md) |
| Installer und Rollout | [`installer/README.md`](installer/README.md) |
| Kiosk-Einrichtung Windows | [`docs/kiosk-einrichtung.md`](docs/kiosk-einrichtung.md) |
| Entwicklung, Tests, CI, Release | [`docs/entwicklung.md`](docs/entwicklung.md) |
| Abnahme-Checkliste | [`docs/abnahme-checkliste.md`](docs/abnahme-checkliste.md) |

## Konfiguration
Zugangsdaten gehören nur in die `.env` auf dem Server, nie ins Repository. Vorlage: `.env.example`.
