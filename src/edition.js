// ---------- Ausgabe der App: mit Konto oder reine Frontend-Version ----------
// FeldFolio gibt es in zwei Ausgaben aus demselben Code:
//   - mit Konto (FeldFolio+): Anmeldung, Cloud-Abgleich, Dashboard, Betrieb …
//   - Frontend-Version: alles, was ohne Anmeldung und ohne Server läuft (Karte,
//     Flächenübersicht, Jahresvergleich, Zeichnen, Pläne, Tierbestand, Exporte).
//     Gebaut mit "npm run build:frontend" (vite --mode frontend, siehe
//     vite.config.js): Dann ist __FF_FRONTEND__ fest "true", die Supabase-
//     Zugangsdaten und die Supabase-Bibliothek kommen gar nicht erst ins Bündel.
//
// In der Frontend-Version sind alle Einstiege ausgeblendet, die ein Konto
// brauchen (Anmelden, Betrieb wählen, Notizen/Fotos an Flächen und Bäumen …) —
// über <html data-edition="frontend"> (style.css) bzw. NUR_FRONTEND im Code.
//
// Im Dev-Server lässt sich die Frontend-Version mit ?edition=frontend ansehen
// und testen (tests/e2e/frontend.spec.js), ohne ihn anders zu starten.
export const NUR_FRONTEND = __FF_FRONTEND__
  || (import.meta.env.DEV && new URLSearchParams(location.search).get('edition') === 'frontend');

if (NUR_FRONTEND) document.documentElement.dataset.edition = 'frontend';
