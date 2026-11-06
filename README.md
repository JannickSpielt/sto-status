# STO Status – Serverstatus und News für Star Trek Online

Web-App fürs iPhone (kann über Safari zum Home-Bildschirm hinzugefügt werden).

## So funktioniert „live“

Ein iPhone kann den Star-Trek-Server nicht direkt abfragen (der Browser blockiert das aus Sicherheitsgründen).
Darum übernimmt eine kostenlose GitHub Action die Abfrage:

1. Alle 5 Minuten fragt `scripts/update.mjs` den offiziellen Launcher-Status und die offiziellen Arc-Games-News ab.
2. Das Ergebnis landet in `data/status.json` und `data/news.json`.
3. GitHub Pages stellt die App samt Daten online, die App lädt die Daten jede Minute und beim Öffnen neu.

Verzögerung insgesamt: meist 5 bis 10 Minuten.

## Einrichten (einmalig, ca. 5 Minuten)

1. Auf github.com ein neues **öffentliches** Repository anlegen, z. B. `sto-status`.
2. Alle Dateien aus diesem Ordner hochladen (inklusive des Ordners `.github`).
3. Repository → **Settings → Pages** → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)` → Save.
4. Repository → **Actions** → Workflow „Status und News aktualisieren“ → **Run workflow** (einmal manuell starten).
5. Nach 1–2 Minuten ist die App unter `https://DEIN-NAME.github.io/sto-status/` erreichbar.

## Aufs iPhone

Adresse in **Safari** öffnen → Teilen-Symbol → **Zum Home-Bildschirm** → Hinzufügen.
