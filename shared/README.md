# Gemeinsame Formate

JSON-Schemas (Draft 2020-12) für alles, was zwischen Studio, API und Player ausgetauscht wird.
Die API prüft Layouts und Manifeste damit (`api/src/Schema/SchemaValidator.php`).

## Layout (`schemas/layout.schema.json`)

```text
Layout
├── schemaVersion: 1
├── format: { orientation: landscape|portrait, width, height }   1920x1080 oder 1080x1920
├── idleTimeoutSeconds                                            zurück zur Startseite, 0 = aus
├── pages[]          erste Seite = Startseite
│   ├── id, name
│   ├── background: { color, image, fit: cover|contain }
│   └── elements[]   Reihenfolge = Ebene (spätere liegen oben)
└── videoPage        Darstellung beim Abspielen eines Videos
    ├── background, fit
    └── header: { height, background, color, backLabel, showTitle, fontSize }
```

### Elemente

Alle Elemente haben `id`, `type`, `x`, `y`, `w`, `h` (Bezugseinheiten) sowie optional `rotation`, `opacity`, `radius`, `action`.

| type | Pflichtfelder | Weitere Felder |
|---|---|---|
| `text` | `text` | `style` |
| `image` | `image` | `fit` |
| `thumbnail` | `video` | `poster`, `title`, `showTitle`, `showPlayIcon`, `style` |
| `button` | `label`, `action` | `style` |
| `shape` | `fill` | – |

`style` (Text): `fontFamily`, `fontSize` (Bezugseinheiten), `fontWeight`, `italic`, `color`, `align`, `verticalAlign`, `lineHeight`, `background`.

Farben immer als `#rrggbb` oder `#rrggbbaa`.

### Aktionen

| Aktion | Wirkung |
|---|---|
| `{ "type": "openVideo", "video": "<datei-id>", "title": "…" }` | Videoseite öffnen; nach Videoende zurück |
| `{ "type": "openPage", "page": "<seiten-id>" }` | andere Seite anzeigen |
| `{ "type": "back" }` | zurück zur vorherigen Seite bzw. Startseite |

Ein Thumbnail öffnet ohne eigene `action` sein Video.

Zusätzlich zum Schema gilt: eindeutige Seiten- und Element-IDs, `openPage` zeigt auf eine vorhandene Seite, Format passt zur Ausrichtung.

## Manifest (`schemas/manifest.schema.json`)

Eine veröffentlichte Revision; **unveränderlich**, zu jeder Revisionsnummer gibt es genau ein Manifest.

| Feld | Bedeutung |
|---|---|
| `schemaVersion` | 1 |
| `revision` | fortlaufende Nummer pro Projekt |
| `publishedAt` | UTC, ISO 8601 |
| `validFrom`, `validTo` | lokale Zeit des Players (`2026-12-01T08:00`) oder `null` |
| `priority` | bei überlappenden Zeitfenstern gewinnt die höhere (M2) |
| `layout` | das Layout (siehe oben) |
| `files[]` | `id`, `path` (`media/<sha256>.<ext>`), `size`, `sha256`, `mime` |

Dateien sind über ihren SHA-256 adressiert. Gleiche Dateien in mehreren Revisionen lädt der Player nur einmal; ein Pfad kann nie außerhalb von `media/` zeigen.
Download-Links stehen nicht im Manifest, sondern kommen zeitlich begrenzt von der Player-API.

## Beispiele

- `examples/layout.example.json`: quer, Startseite mit Titel, Logo und zwei Videos
- `examples/layout-hochkant.example.json`: hochkant, zweite Seite mit Zurück-Button
- `examples/manifest.example.json`: Revision 7 mit fünf Dateien
