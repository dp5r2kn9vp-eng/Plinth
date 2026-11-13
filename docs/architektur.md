# Architektur

## Überblick

```
 Plinth Studio (Browser)                     Plinth Player (Windows, n Geräte)
   │  Login, Entwürfe, Veröffentlichen          │  Revision prüfen (30–60 s), Manifest holen
   │                                            │
   ▼                                            ▼
 PHP-API  /api/v1  ───────── MySQL/MariaDB (Kunden, Geräte, Entwürfe, Revisionen, Dateien)
   │
   │ signiert Upload-/Download-URLs (zeitlich begrenzt)
   ▼
 S3-kompatibler Speicher (privat)  ◄── Browser lädt direkt hoch, Player lädt direkt herunter
```

Große Dateien laufen nie durch PHP: Die API stellt nur signierte URLs aus. Dadurch reicht günstiges Shared Hosting oder ein kleiner Server für die API.

## Monorepo

| Ordner | Inhalt |
|---|---|
| `/api` | PHP-Backend (PHP ≥ 8.2, Composer, ohne Framework) |
| `/studio` | Designer als statische Web-App (ES-Module, kein Build-Schritt) |
| `/player` | Windows-Player (Electron) |
| `/shared` | JSON-Schemas, Beispiele und der gemeinsame Layout-Renderer |
| `/installer` | Installer-Konfiguration und Kiosk-Skripte |
| `/docs` | Doku, Tickets, Abnahme-Checkliste |

Konfiguration: nur über `.env` (Vorlage `.env.example`). Zugangsdaten stehen nie im Repository.

## Entscheidung: Player mit Electron (statt .NET/WebView2)

**Gewählt: Electron.**

- **Ein Renderer für Studio und Player.** Das Layout wird in beiden mit demselben Code aus `/shared/renderer` als HTML gezeichnet. Die Vorschau im Studio sieht damit genau so aus wie auf dem Bildschirm, ohne zweite Implementierung in C#.
- **Video:** Electron bringt Chromium mit H.264/AAC-Unterstützung mit, unabhängig davon, welche Codecs auf dem Windows-Gerät installiert sind. WebView2 hängt von der installierten Edge-Runtime ab.
- **Kiosk:** `kiosk: true`, Vollbild, kein Menü sind eingebaut; Watchdog und Autostart über den Installer.
- **Sichere Ablage:** `safeStorage` nutzt unter Windows DPAPI, wie im Ticket gefordert.
- **Auslieferung:** `electron-builder` erzeugt den Windows-Installer und bringt Auto-Update (M2) und Code-Signing (M2) mit.
- **Testbarkeit:** Läuft auch unter Linux/macOS, damit Entwicklung und automatisierte Tests ohne Windows-Rechner möglich sind.

Nachteile: größerer Download (~100 MB) und mehr RAM (~200–300 MB) als eine .NET-App. Für dedizierte Kiosk-Rechner ist das unkritisch.

## Entscheidung: Designer als DOM-Editor (statt Konva/Fabric.js)

**Gewählt: eigener Editor auf Basis von HTML-Elementen, ohne Canvas-Bibliothek.**

- Konva und Fabric zeichnen auf ein `<canvas>`. Der Player muss aber Videos, Text und Bilder als HTML darstellen. Mit Canvas im Designer gäbe es zwei Darstellungen, die auseinanderlaufen (Schrift-Umbruch, Rundungen, Bildzuschnitt).
- Der Designer nutzt deshalb denselben Renderer wie der Player und legt nur Auswahlrahmen, Anfasser und Hilfslinien darüber. Verschieben und Größe ändern laufen über Pointer-Events.
- Kein Build-Schritt: Plain JavaScript als ES-Module. Das Studio kann als statische Dateien auf demselben Webspace wie die API liegen.

## Koordinaten

Layouts sind in Bezugseinheiten gespeichert: quer 1920×1080, hochkant 1080×1920. Studio und Player skalieren diese Fläche proportional auf die echte Bildschirm- bzw. Fenstergröße (bei abweichendem Seitenverhältnis mit Rand). Damit sind alle Positionen relativ zum Bezugsformat und unabhängig von der Auflösung des Geräts.

## Datenfluss beim Veröffentlichen

1. Studio speichert den Entwurf (Layout-JSON) laufend per Autosave.
2. Medien lädt der Browser per Multipart direkt in den Speicher; die API prüft danach Größe und Hash.
3. „Veröffentlichen“ friert den Entwurf ein: neue Revisionsnummer, Manifest mit allen Dateien und SHA-256. Die Revision wird erst aktiv, wenn alle Dateien vorhanden sind.
4. Player fragen die aktuelle Revisionsnummer ab (günstig, mit ETag). Bei Änderung holen sie das Manifest und signierte Download-Links, laden nur fehlende Dateien, prüfen die Hashes und schalten erst um, wenn alles da ist.

## Formate

- Layout: [`shared/schemas/layout.schema.json`](../shared/schemas/layout.schema.json)
- Manifest: [`shared/schemas/manifest.schema.json`](../shared/schemas/manifest.schema.json)
- Beschreibung und Beispiele: [`shared/README.md`](../shared/README.md)
