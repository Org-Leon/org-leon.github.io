# Agent-Hinweise für dieses Repo (FeldFolio)

1. **Nach jeder Änderung immer einen Regressionstest durchführen**, bevor die
   Aufgabe als erledigt gilt:
   - `node --check src/main.js` (Syntax-Check) und eine CSS-Klammer-Balance-
     Prüfung von `src/style.css` (öffnende/schließende `{`/`}` zählen).
   - Live im laufenden Dev-Server (`npm run dev`, meist bereits unter
     `http://localhost:5173`) über Playwright verifizieren: die geänderte
     Funktion tatsächlich ausführen, nicht nur den Code lesen — inklusive
     der Funktionen, die die Änderung indirekt berühren könnte (z.B. beim
     Anpassen gemeinsam genutzter Handler wie `L.Draw.Event.CREATED` auch
     die jeweils ANDEREN Werkzeuge testen, die denselben Event nutzen).
   - Für Interaktionen, die sich nicht zuverlässig per simuliertem
     Maus-/Tastatur-Event auslösen lassen (Leaflet.draw-Zeichnen, Vertex-
     Drag): direkt die entsprechenden Events/Objekte im Browser ansteuern
     (z.B. `map.fire('draw:created', {...})`). Für den Zugriff auf die
     modul-interne `map`-Variable bei Bedarf temporär
     `window.__ffTestMap = map;` direkt nach der `map`-Deklaration in
     `src/main.js` einfügen — und **vor Abschluss der Aufgabe wieder
     entfernen** (per `grep` bestätigen, dass keine `__ffTest*`-Reste mehr
     im Code sind).
   - Test-Artefakte danach aufräumen: Playwright-Screenshots/-Downloads
     (`.playwright-mcp/`) löschen, und falls mit einem echten Cloud-Konto
     getestet wurde, versehentlich synchronisierte Testdaten dort wieder
     entfernen.
