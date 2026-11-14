# Ende-zu-Ende-Tests (Studio)

Laufen mit Playwright gegen eine laufende Installation (API, Studio, S3-kompatibler Speicher mit CORS).

```bash
cd tests && npm install && npx playwright install chromium
PLINTH_URL=http://localhost:8099 PLINTH_EMAIL=praxis@plinth.test PLINTH_PASSWORD=Demo-Passwort-2026 npm run e2e
```

Testmedien liegen in `tests/fixtures` (4 s Testbild als WebM/MP4, Hintergrundbild). Eine lokale Testumgebung beschreibt [`docs/entwicklung.md`](../../docs/entwicklung.md).

Hinweis: Das Chromium von Playwright kann kein H.264 abspielen, deshalb WebM. Der Player (Electron) spielt H.264.
