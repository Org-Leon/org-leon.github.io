# Agent-Hinweise für dieses Repo (FeldFolio)

1. **Nach jeder Änderung immer einen echten Regressionstest durchführen**,
   bevor die Aufgabe als erledigt gilt — nicht nur manuell im Browser
   nachsehen, sondern die automatisierte Suite laufen lassen:
   - `node --check src/main.js` (Syntax-Check) und eine CSS-Klammer-Balance-
     Prüfung von `src/style.css` (öffnende/schließende `{`/`}` zählen).
   - `npm test` (Playwright Test, `tests/e2e/`) ausführen — startet bei
     Bedarf automatisch `npm run dev` (siehe `playwright.config.js`,
     `webServer` mit `reuseExistingServer: true`, läuft also auch gegen
     einen bereits offenen Dev-Server auf Port 5173). Für neue/geänderte
     Funktionalität **eine neue Testdatei anlegen oder eine bestehende
     erweitern** statt die Regression nur einmalig manuell zu prüfen — die
     Suite muss mit der App mitwachsen. Vorhandene Specs als Vorlage
     nehmen: `tests/e2e/zeichner.spec.js`, `tests/e2e/hofplan.spec.js`,
     `tests/e2e/gesamtexport.spec.js`, `tests/e2e/layout.spec.js`.
   - Schlägt ein Test fehl, der Grund aber eindeutig eine Eigenheit des
     Testaufbaus ist (z.B. Server durch zu viele parallele Worker
     überlastet, mobiler Sidebar-Einschub nicht geöffnet) statt ein
     echter App-Fehler: den Test fixen, nicht nur ignorieren.
   - Test-Artefakte danach aufräumen: `test-results/` und
     `playwright-report/` sind bereits gitignored, aber lokal löschen
     (`rm -rf test-results playwright-report`) hält den Workspace sauber.
     Falls zusätzlich manuell mit einem echten Cloud-Konto getestet wurde,
     versehentlich synchronisierte Testdaten dort wieder entfernen.

2. **Testaufbau**: `@playwright/test` ist als Dev-Dependency installiert
   (`npm test` = `playwright test`, Config in `playwright.config.js`,
   Chromium-Browser lokal installiert). Leaflet.draw-Zeichnen/Vertex-Drag
   lässt sich nicht zuverlässig per simuliertem Maus-/Tastatur-Event
   auslösen — Tests lösen solche Interaktionen stattdessen direkt über die
   modul-interne `map`-Instanz aus (`map.fire('draw:created', {...})`,
   direktes `layer.editing.enable()`/Marker-Events feuern). Der Zugriff
   darauf läuft über `window.__ffTestMap`, das in `src/main.js` direkt nach
   der `map`-Deklaration **dauerhaft, aber nur im Dev-Server** gesetzt wird
   (`if (import.meta.env.DEV) window.__ffTestMap = map;` — im
   Produktions-Build per Dead-Code-Elimination entfernt, taucht also nie in
   `docs/` auf). Wiederverwendbare Test-Helfer (Tab wechseln, Zeichnen
   auslösen, Testkoordinaten) liegen in `tests/e2e/helpers.js`.

3. Für rein visuelle Prüfungen (Layout-Feinheiten, Screenshots), die sich
   nicht sinnvoll als Assertion ausdrücken lassen, weiterhin die
   interaktive Playwright-MCP-Anbindung nutzen — Screenshots danach löschen
   (`.playwright-mcp/`, bereits gitignored). Das ersetzt aber nicht Punkt 1:
   funktionale Änderungen brauchen einen Platz in der `tests/e2e/`-Suite.

4. **Icons**: Alle funktionalen Icons in der App sind Google Material
   Symbols (Stil Rounded, Icon-Name als Ligatur-Text, z.B.
   `<span class="material-symbols-rounded icon">draw</span>`) — Ausnahme
   ist die Apfel-Illustration im `#brand-logo`-Schriftzug, die bleibt
   unangetastet (Markenzeichen, kein UI-Icon). Die volle
   `material-symbols`-Variable-Font wiegt 5+ MB; eingebunden ist
   stattdessen eine auf die tatsächlich genutzten Icon-Namen UND auf eine
   feste Achsen-Instanz reduzierte Datei (`src/assets/material-symbols-
   rounded-subset.woff2`, ~270 KB, per `@font-face` in `src/style.css`).
   **Bei einem neuen Icon-Namen** die Liste `ICON_NAMES` in
   `scripts/subset-icons.mjs` ergänzen und `node scripts/subset-icons.mjs`
   erneut ausführen — sonst zeigt das neue Icon nur den Rohtext statt der
   Glyphe. `material-symbols` (die volle Font, Quelle fürs Subsetting) und
   `subset-font` (das Subsetting-Werkzeug) sind reine Dev-Dependencies.
