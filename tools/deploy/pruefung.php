<?php
declare(strict_types=1);

// Plinth – Prüfseite für den Browser.
// Freischalten: in plinth.env CHECK_TOKEN=<zufälliger Text, mind. 20 Zeichen> eintragen,
// dann https://<domain>/pruefung.php?token=<derselbe Text> aufrufen.
// Nach der Einrichtung CHECK_TOKEN wieder entfernen (oder diese Datei löschen).

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');

$autoload = __DIR__ . '/api/vendor/autoload.php';
if (!is_file($autoload)) {
    http_response_code(500);
    exit('Ordner api/vendor fehlt – bitte vollständig hochladen.');
}
require $autoload;

$config = Plinth\Api\Config::load();
$expected = (string) $config->get('CHECK_TOKEN', '');
$given = (string) ($_GET['token'] ?? '');

$given = trim($given);
if (strlen($expected) < 20) {
    http_response_code(403);
    $found = Plinth\Api\Config::envFile();
    $raw = $found !== null ? (string) @file_get_contents($found) : '';
    $hasLine = (bool) preg_match('/^\s*CHECK_TOKEN\s*=/m', $raw);
    $reason = match (true) {
        $found === null => 'Es wurde keine Konfigurationsdatei gefunden.',
        !$hasLine => 'Die Konfigurationsdatei wurde gefunden, enthält aber keine Zeile „CHECK_TOKEN=…“.',
        default => 'Die Zeile „CHECK_TOKEN=…“ ist da, der Wert hat aber nur ' . strlen($expected) . ' Zeichen (mindestens 20 nötig, ohne Leerzeichen und Anführungszeichen).',
    };
    echo '<!DOCTYPE html><meta charset="utf-8"><body style="font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px">';
    echo '<h1 style="font-size:20px">Prüfseite ist ausgeschaltet</h1><p><strong>' . htmlspecialchars($reason) . '</strong></p>';
    echo '<p>Gesucht wurde hier:</p><ul>';
    foreach (Plinth\Api\Config::diagnose() as $d) {
        echo '<li>' . htmlspecialchars($d['ort']) . ': ' . htmlspecialchars($d['status']) . '</li>';
    }
    echo '</ul><p>So muss die Zeile in der <code>plinth.env</code> aussehen (eigene Zeile, ohne Leerzeichen):<br><code>CHECK_TOKEN=PUApvLpFKEai1qYua7rqddrk7Mh5oAdE</code></p>';
    echo '<p>„Über dem Webroot“ heißt: neben dem Ordner, in dem <code>pruefung.php</code> liegt – nicht darin.</p></body>';
    exit;
}
if (!hash_equals($expected, $given)) {
    usleep(500000); // bremst Raten
    http_response_code(403);
    exit('<!DOCTYPE html><meta charset="utf-8"><body style="font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px"><h1 style="font-size:20px">Schlüssel passt nicht</h1>'
        . '<p>Die Prüfseite ist eingeschaltet, aber der Schlüssel in der Adresse stimmt nicht mit <code>CHECK_TOKEN</code> in der plinth.env überein'
        . ($given === '' ? ' – in der Adresse fehlt <code>?token=…</code>.' : ' (Adresse: ' . strlen($given) . ' Zeichen, plinth.env: ' . strlen($expected) . ' Zeichen).') . '</p>'
        . '<p>Aufruf: <code>/pruefung.php?token=</code> gefolgt vom Wert aus der plinth.env.</p></body>');
}

// Ersten Benutzer anlegen (nur solange keiner existiert)
$firstUser = null;
$firstResult = null;
try {
    $firstUser = new Plinth\Api\Setup\FirstUser(Plinth\Api\Database::connect($config));
    if (!$firstUser->allowed()) {
        $firstUser = null;
    }
} catch (Throwable) {
    $firstUser = null; // Datenbank noch nicht bereit – zeigt die Prüfung unten
}
if ($firstUser !== null && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $firstResult = $firstUser->create(
        (string) ($_POST['kunde'] ?? ''),
        (string) ($_POST['name'] ?? ''),
        (string) ($_POST['email'] ?? ''),
        (string) ($_POST['password'] ?? ''),
        (string) ($_POST['password2'] ?? ''),
    );
    if ($firstResult['errors'] === []) {
        $firstUser = null;
    }
}

$check = new Plinth\Api\Setup\Check();
$lines = $check->run();

// Signierte URL für den Browser-Test (prüft die CORS-Regel des Buckets aus Sicht des Browsers)
$corsUrl = null;
try {
    $storage = Plinth\Api\Storage\S3Storage::fromConfig($config);
    $cmd = $storage->client()->getCommand('PutObject', ['Bucket' => $storage->bucket(), 'Key' => 'plinth-check/browser-test.txt']);
    $corsUrl = (string) $storage->client()->createPresignedRequest($cmd, '+10 minutes')->getUri();
} catch (Throwable) {
    $corsUrl = null;
}
$colors = ['OK' => '#1f9d6b', 'FEHLER' => '#d64545', 'HINWEIS' => '#b7791f'];
?>
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plinth – Prüfung</title>
<style>
  body { font: 15px/1.5 system-ui, "Segoe UI", sans-serif; margin: 0; padding: 24px 16px; background: #f6f7f9; color: #1c2128; }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sum { padding: 12px 16px; border-radius: 8px; margin: 16px 0; font-weight: 600; color: #fff; }
  ul { list-style: none; padding: 0; margin: 0; background: #fff; border: 1px solid #dde1e6; border-radius: 8px; }
  li { padding: 10px 14px; border-top: 1px solid #eef0f3; }
  li:first-child { border-top: 0; }
  .st { display: inline-block; min-width: 70px; font-weight: 700; }
  .hint { color: #555; margin: 4px 0 0 74px; }
  footer { color: #666; font-size: 13px; margin-top: 16px; }
  .form { background: #fff; border: 1px solid #dde1e6; border-radius: 8px; padding: 14px 16px; }
  .form label { display: block; margin-bottom: 10px; font-size: 14px; color: #444; }
  .form input { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; padding: 8px 10px; font: inherit; border: 1px solid #c9ced6; border-radius: 6px; }
  .form button { font: inherit; font-weight: 600; padding: 9px 16px; border: 0; border-radius: 6px; background: #1f9d6b; color: #fff; cursor: pointer; }
  .err { color: #d64545; margin: 0 0 8px; }
</style>
</head>
<body>
<main>
  <h1>Plinth – Prüfung der Installation</h1>
  <div class="sum" style="background: <?= $check->ok() ? '#1f9d6b' : '#d64545' ?>">
    <?= $check->ok() ? 'Alles bereit.' : 'Bitte die rot markierten Punkte beheben.' ?>
  </div>
  <ul>
  <?php foreach ($lines as $l): ?>
    <li>
      <span class="st" style="color: <?= $colors[$l['status']] ?>"><?= htmlspecialchars($l['status']) ?></span>
      <?= htmlspecialchars($l['text']) ?>
      <?php if ($l['hint'] !== ''): ?><div class="hint">→ <?= htmlspecialchars($l['hint']) ?></div><?php endif; ?>
    </li>
  <?php endforeach; ?>
  </ul>
  <?php if ($firstResult !== null && $firstResult['errors'] === []): ?>
    <div class="sum" style="background:#1f9d6b">Benutzer angelegt. Kundencode für die Player: <code style="font-size:17px"><?= htmlspecialchars($firstResult['kundencode']) ?></code><br>
      Jetzt im <a href="/studio/" style="color:#fff">Studio anmelden</a>.</div>
  <?php endif; ?>

  <?php if ($firstUser !== null): ?>
    <h2 style="font-size:17px;margin:24px 0 8px">Ersten Benutzer anlegen</h2>
    <form method="post" class="form">
      <?php foreach (($firstResult['errors'] ?? []) as $msg): ?><p class="err"><?= htmlspecialchars($msg) ?></p><?php endforeach; ?>
      <label>Kunde / Firma<input name="kunde" required maxlength="190" value="<?= htmlspecialchars((string) ($_POST['kunde'] ?? '')) ?>"></label>
      <label>Dein Name<input name="name" required maxlength="190" value="<?= htmlspecialchars((string) ($_POST['name'] ?? '')) ?>"></label>
      <label>E-Mail (Anmeldung)<input name="email" type="email" required value="<?= htmlspecialchars((string) ($_POST['email'] ?? '')) ?>"></label>
      <label>Passwort (mind. 10 Zeichen)<input name="password" type="password" required minlength="10" autocomplete="new-password"></label>
      <label>Passwort wiederholen<input name="password2" type="password" required minlength="10" autocomplete="new-password"></label>
      <button type="submit">Benutzer anlegen</button>
    </form>
  <?php endif; ?>

  <h2 style="font-size:17px;margin:24px 0 8px">Upload aus dem Browser (CORS)</h2>
  <ul><li id="cors"><span class="st" style="color:#666">…</span> wird geprüft</li></ul>
  <footer>Nach der Einrichtung <code>CHECK_TOKEN</code> aus der plinth.env entfernen – dann ist diese Seite wieder aus.</footer>
</main>
<script>
(async () => {
  const el = document.getElementById('cors');
  const url = <?= json_encode($corsUrl, JSON_UNESCAPED_SLASHES) ?>;
  const show = (ok, text, hint) => {
    el.innerHTML = '';
    const st = document.createElement('span');
    st.className = 'st';
    st.style.color = ok ? '#1f9d6b' : '#d64545';
    st.textContent = ok ? 'OK' : 'FEHLER';
    el.append(st, ' ' + text);
    if (hint) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = '→ ' + hint;
      el.append(h);
    }
  };
  if (!url) return show(false, 'Kein Test möglich', 'Speicher-Zugang oben zuerst reparieren.');
  try {
    const res = await fetch(url, { method: 'PUT', body: 'ok' });
    if (!res.ok) return show(false, `Speicher antwortet ${res.status}`, 'Zugangsdaten und Bucket-Namen in plinth.env prüfen.');
    if (!res.headers.get('ETag')) return show(false, 'Upload klappt, aber ETag ist nicht lesbar', 'In der CORS-Regel "ExposeHeaders": ["ETag"] ergänzen.');
    show(true, 'Browser darf direkt in den Speicher hochladen (CORS korrekt)');
  } catch (e) {
    show(false, 'Browser darf nicht in den Speicher hochladen', 'CORS-Regel im Bucket fehlt oder die Domain stimmt nicht. Erlaubt sein muss genau: ' + location.origin);
  }
})();
</script>
</body>
</html>
