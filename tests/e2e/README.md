# Ende-zu-Ende-Tests (Studio)

Laufen mit Playwright gegen eine laufende Installation (API, Studio, S3-kompatibler Speicher mit CORS).

```bash
# Testmedien erzeugen
mkdir -p /tmp/plinth-media && cd /tmp/plinth-media
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=25 -f lavfi -i sine=frequency=440 -t 6 -c:v libvpx-vp9 -c:a libopus -shortest film.webm
ffmpeg -f lavfi -i "gradients=size=1920x1080" -frames:v 1 hintergrund.jpg

# Tests
PLINTH_URL=http://localhost:8099 PLINTH_EMAIL=praxis@plinth.test PLINTH_PASSWORD=Demo-Passwort-2026 \
MEDIA_DIR=/tmp/plinth-media node --test tests/e2e/studio.e2e.mjs
```

Hinweis: Das Chromium von Playwright kann kein H.264 abspielen, deshalb WebM. Der Player (Electron) spielt H.264.
