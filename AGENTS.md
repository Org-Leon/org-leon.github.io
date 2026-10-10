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
   **Geräteschutz** (Verschlüsselung + Sperrbildschirm, `src/geraeteschutz.js`)
   ist in Playwright-Läufen aus (Dev-Server + `navigator.webdriver`), sonst
   stünde vor jedem Test der Sperrbildschirm. Tests dafür schalten ihn per
   `page.addInitScript(() => { window.__ffTestGeraeteschutz = true; })` ein,
   siehe `tests/e2e/geraeteschutz.spec.js`. Im Produktions-Build immer aktiv.
   Ebenso der Hinweis „Da ist etwas schiefgelaufen“ von **Fehler melden**
   (`src/fehlerbericht.js`): in Tests aus, `window.__ffTestFehlerHinweis`
   schaltet ihn ein; der Server wird über `window.__ffTestFehler` gestubbt
   (`tests/e2e/fehlerbericht.spec.js`).

3. Für rein visuelle Prüfungen (Layout-Feinheiten, Screenshots), die sich
   nicht sinnvoll als Assertion ausdrücken lassen, weiterhin die
   interaktive Playwright-MCP-Anbindung nutzen — Screenshots danach löschen
   (`.playwright-mcp/`, bereits gitignored). Das ersetzt aber nicht Punkt 1:
   funktionale Änderungen brauchen einen Platz in der `tests/e2e/`-Suite.

4. **Icons**: Alle funktionalen Icons in der App sind Google Material
   Symbols (Stil Rounded, Icon-Name als Ligatur-Text, z.B.
   `<span class="material-symbols-rounded icon">draw</span>`) — Ausnahme
   ist die Apfel-Illustration im `#brand-logo`-Schriftzug, die bleibt
   unangetastet (Markenzeichen, kein UI-Icon). Im Test-Design „Feldbuch“
   (`src/design-feldbuch.css`) bleibt das Logo ebenfalls erhalten — dort steht nur der
   Schriftzug in Tinte statt Markengrün (Wunsch: Logo höchstens dezent
   anpassen, Apfel und „+“ nicht verändern). Die volle
   `material-symbols`-Variable-Font wiegt 5+ MB; eingebunden ist
   stattdessen eine auf die tatsächlich genutzten Icon-Namen UND auf eine
   feste Achsen-Instanz reduzierte Datei (`src/assets/material-symbols-
   rounded-subset.woff2`, ~270 KB, per `@font-face` in `src/style.css`).
   **Bei einem neuen Icon-Namen** die Liste `ICON_NAMES` in
   `scripts/subset-icons.mjs` ergänzen und `node scripts/subset-icons.mjs`
   erneut ausführen — sonst zeigt das neue Icon nur den Rohtext statt der
   Glyphe. Dasselbe Skript erzeugt eine zweite Datei fürs Test-Design
   „Feldbuch“ (`src/assets/material-symbols-sharp-feldbuch.woff2`, Stil
   „Sharp“ mit dünnem Strich) aus `ICON_NAMES` plus `FELDBUCH_ICON_NAMES` —
   dort stehen die Themen-Symbole, die `src/design-feldbuch.css` per `--ikon`
   an die Stelle der normalen setzt (HTML bleibt unverändert).
   `material-symbols` (die volle Font, Quelle fürs Subsetting) und
   `subset-font` (das Subsetting-Werkzeug) sind reine Dev-Dependencies.

5. **Benutzerhandbuch aktuell halten**: `HANDBUCH.md` (Repo-Wurzel) ist die
   Dokumentation für die Nutzer der App (Öko-Kontrolleure, keine Entwickler)
   — auf Deutsch, in Du-Form, ohne Code- und Dateinamen. **Jede Änderung, die
   Nutzer sehen oder bedienen** (neue/geänderte/entfernte Funktion, andere
   Beschriftung, anderer Ablauf, neue Grenze oder neuer Hinweis), gehört im
   selben Zug ins Handbuch: betroffenes Kapitel anpassen, bei neuen Funktionen
   ein Kapitel bzw. einen Abschnitt ergänzen (Inhaltsverzeichnis mitziehen),
   Entferntes streichen und das „Stand“-Datum oben aktualisieren. Nur
   beschreiben, was die App tatsächlich tut — Beschriftungen wörtlich wie in
   der Oberfläche. Reine interne Änderungen (Refactoring, Tests) brauchen
   keinen Eintrag.

6. **Sicherheitsregeln (Content-Security-Policy, Prüfsummen)**: Die Seite
   läuft mit einer strengen CSP, die `cspPlugin()` in `vite.config.js` als
   Meta-Tag setzt (Dev und Build) — **ohne `unsafe-inline` und ohne
   `unsafe-eval` für Skripte**. Daraus folgt:
   - **Neue externe Quelle** (Kartenserver, API, Bibliothek, Schrift)? In
     `cspPlugin()` eintragen, sonst blockiert der Browser sie. `npm test`
     prüft das (`tests/e2e/csp.spec.js` klickt durch die Ansichten und meldet
     jeden Verstoß) — bei neuen Ansichten/Nachladern den Test erweitern.
   - **Kein eingebettetes JavaScript im HTML**: keine `onclick="…"`-Attribute
     (auch nicht in per `innerHTML` erzeugtem HTML), keine neuen
     `<script>`-Blöcke. Stattdessen `addEventListener`/Delegation. Das eine
     vorhandene Inline-Skript (Theme in `index.html`) ist über seine Prüfsumme
     erlaubt, die das Plugin selbst berechnet.
   - **Kein `eval`/`new Function`**, auch nicht über Bibliotheken. Deshalb
     kommt Turf per npm (`src/geo.js`, Turf 7 mit den Aufrufen von 6.5) und
     OpenCV läuft in einem eigenen Rahmen (`public/scan-sandbox.html`, eigene
     enge Policy; `cv.imread`/`cv.imshow` dort nicht nutzen, sondern
     `matVonCanvas`/`matAufCanvas` in `src/scan-engine.js`).
   - **Bibliotheken von cdnjs** nur mit `integrity`-Prüfsumme (siehe
     Kommentar in `index.html`; Prüfsummen von
     `https://api.cdnjs.com/libraries/<name>/<version>?fields=sri`). Die CSP
     erlaubt genau die in `index.html` eingebundenen Dateien, nicht den ganzen
     Host. Neue Bibliotheken bevorzugt per npm mitbauen.
   - **Dev-Server**: `npm run dev` ist nur auf diesem Rechner erreichbar und
     liefert `test-shapes/` (echte Betriebsdaten) nicht aus. Für Tests vom
     Handy im selben WLAN `npm run dev:lan` — nicht in fremden Netzen.
   - **Schriften** liefert die App selbst aus (npm-Pakete `@fontsource…`,
     `@font-face` in `src/style.css` bzw. `src/design-feldbuch.css`) — keine
     Google Fonts oder andere Schrift-CDNs (IP-Adressen an Dritte, DSGVO).
   - **Nutzerdaten auf dem Gerät** nur über `src/offline-store.js` ablegen
     (IndexedDB bzw. `cacheVerpacken`/`cacheAuspacken` für die Cache API):
     dort werden sie bei aktivem Geräteschutz verschlüsselt. Keine
     Kontrolldaten in `localStorage` (nur Ansichts-Einstellungen).
   - **Server-Regeln** (RLS, Trigger) liegen als SQL in `supabase/`; der
     öffentliche Schlüssel steckt in der App, den Schutz leisten allein diese
     Regeln. `supabase/rls-pruefen.sql` zeigt den Ist-Zustand.
   - **Admin** ist, wer in der Tabelle `admin_konten` steht
     (`supabase/admins.sql`, Funktion `public.ist_admin()`) — nicht jede
     @oekop.de-Adresse (die dürfen sich nur registrieren). Neue Admin-Prüfungen
     in SQL immer über `public.ist_admin()`; die App fragt den Status per
     `istAdminAbfragen()` (Tests: `window.__ffTestAdmin = true`).
     Admin-**Rechte** gibt es nur mit zweitem Faktor (TOTP, `aal2`, höchstens
     12 Stunden alt) — `admin_konto()` sagt nur, ob jemand auf der Liste steht
     (Verwaltung anzeigen, Code abfragen). Tests stellen den Faktor über
     `window.__ffTestMfa = { eingerichtet, freigeschaltet, code }` nach; fehlt
     es, gilt ein Admin im Test als freigeschaltet (`tests/e2e/admin-2fa.spec.js`).

7. **Zwei Ausgaben aus einem Code** (`src/edition.js`): mit Konto
   (FeldFolio+, `npm run build`, braucht die Supabase-Werte aus `.env`) und
   die **Frontend-Version ohne Anmeldung und Server**
   (`npm run build:frontend` = `vite build --mode frontend`). Im
   Frontend-Build ist `__FF_FRONTEND__` fest `true`: Supabase-Zugangsdaten
   und -Bibliothek landen nicht im Bündel, die CSP erlaubt keine
   Server-Verbindungen, alle Konto-Einstiege sind ausgeblendet
   (`<html data-edition="frontend">` in `src/style.css`, `NUR_FRONTEND` im
   Code). **Neue Funktion, die ein Konto braucht?** Ihren Einstieg in der
   Frontend-Version ausblenden und `tests/e2e/frontend.spec.js` erweitern
   (der Test prüft u. a., dass nirgends „anmelden“ steht und kein fremder
   Server angesprochen wird). Im Dev-Server schaltet `?edition=frontend` die
   Frontend-Version ein. Keine zwei Code-Stände pflegen — beide Ausgaben
   kommen aus demselben Branch.
   **Veröffentlicht** wird die Frontend-Version über GitHub Pages (Branch
   `main`, Ordner `docs/`, dort immer `npm run build:frontend`), die Version
   mit Konto bei Cloudflare Pages (https://feldfolio-plus.pages.dev, `wrangler.jsonc`,
   `npm run deploy:plus` baut nach `dist-plus/` und lädt hoch; Sicherheits-
   Header in `public/_headers`). `dist-plus/` ist gitignored.
