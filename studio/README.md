# Plinth Studio

Web-Designer für die Bildschirminhalte. Statische Dateien (HTML, CSS, ES-Module), **kein Build-Schritt**.

## Aufbau

| Datei | Inhalt |
|---|---|
| `login.html` | Anmeldung |
| `index.html`, `app.js` | App: Projekte, Editor, Autosave, Tastenkürzel |
| `editor/store.js` | Layout-Zustand, Rückgängig/Wiederholen |
| `editor/canvas.js` | Arbeitsfläche: Auswahl, Verschieben, Größe ändern, Einrasten, Raster |
| `editor/inspector.js` | Eigenschaften von Elementen, Seiten und Videoseite |
| `editor/library.js`, `editor/assets.js` | Medienbibliothek, Uploads |
| `editor/preview.js` | Vorschau mit derselben Laufzeit wie der Player |
| `editor/publish.js` | Veröffentlichen mit Fehleranzeige |
| `devices.js` | Geräte, Kundencode |
| `devices-offline.js`, `lib/mode.js` | Offline-Betrieb (Plinth Studio Desktop): Player im Netz finden, koppeln, PIN; Verteilen beim Veröffentlichen |
| `lib/uploader.js` | Multipart-Upload: 3 Teile parallel, SHA-256 pro Teil, Pause/Fortsetzen (auch nach Neuladen), Abbrechen |
| `lib/sha256.js`, `lib/hash-worker.js` | SHA-256 großer Dateien im Hintergrund |
| `lib/media.js` | Abmessungen, Dauer, Standbild von Videos |

Gezeichnet wird mit dem gemeinsamen Renderer aus [`/shared/renderer`](../shared/renderer); die Vorschau verhält sich deshalb genauso wie der Player.

## Bedienung

- Elemente über „Einfügen“ oder aus der Medienbibliothek hinzufügen, ziehen, an den Anfassern skalieren (Umschalt = Seitenverhältnis halten, Alt = ohne Einrasten)
- Pfeiltasten verschieben (Umschalt: 10er-Schritte), Entf löscht, Strg+D dupliziert, Strg+Z / Strg+Umschalt+Z
- Ebenen im Inspektor (nach vorne/hinten), Raster in der Werkzeugleiste
- Speichert automatisch 1,2 s nach der letzten Änderung. Wurde der Entwurf zwischenzeitlich woanders gespeichert, fragt das Studio, welche Version gilt

## Auslieferung

`/studio` und `/shared` müssen neben `/api` unter derselben Domain liegen (Studio ruft `/api/v1` auf und lädt `/shared/renderer`). Für Uploads braucht der Bucket CORS für diese Domain (`php api/bin/s3-setup.php`).

Lokale Entwicklung: PHP-Server mit Router, der `/api/*` an `api/public/index.php` gibt und `/studio`, `/shared` statisch ausliefert (ES-Module brauchen `Content-Type: text/javascript`).

## Tests

Ende-zu-Ende mit Playwright: siehe [`tests/e2e/README.md`](../tests/e2e/README.md).
