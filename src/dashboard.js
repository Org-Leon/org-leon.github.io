// Kontrolle → Übersicht als Baukasten: jeder Nutzer wählt seine Bausteine und
// ordnet sie frei auf einem Raster an (verschieben, Breite und Höhe ziehen,
// Lücken erlaubt). Die Anordnung liegt im Profil (kontoProfil.dashboard, main.js)
// und wird mit dem Konto abgeglichen — gilt also auf allen Geräten.
//
// Das Raster stellt gridstack.js (MIT, ohne eval). Dieses Modul kennt nur Raster
// und Bearbeiten-Modus. Was ein Baustein zeigt, definiert main.js (KO_BAUSTEINE):
//   { titel, icon, text (Beschreibung für "hinzufügen"), w?, h? (Startgröße),
//     rahmenlos?, aktion?: html (Knopf rechts im Kopf), inhalt(): html, danach?(el): void }
// Layout: [{ id, x, y, w, h }] in einem Raster mit 12 Spalten; Zeilen sind ZEILE px hoch.
// Ist der Platz schmal (Handy), stehen die Bausteine in einer Spalte untereinander.
import { GridStack } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';

const SPALTEN = 12;
const SCHMAL = 600;  // Rasterbreite in px, darunter nur eine Spalte
const ZEILE = 48;    // Höhe einer Rasterzeile in px
const ABSTAND = 6;   // halber Abstand zwischen Bausteinen in px

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ganz = (v, min, max, std) => Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : std;
const unterkante = (layout) => layout.reduce((m, x) => Math.max(m, x.y + x.h), 0);

// Gespeichertes Layout bereinigen: nur bekannte Bausteine, jeder höchstens einmal,
// Plätze im Raster. Das alte Format [{ id, breit }] (zweispaltige Liste) wird in
// Rasterplätze umgerechnet: halbe Bausteine nebeneinander, breite über die ganze Zeile.
export function layoutBereinigen(layout, bausteine, standard) {
  const quelle = Array.isArray(layout) ? layout : standard;
  const gesehen = new Set();
  const liste = quelle.filter(x => x && bausteine[x.id] && !gesehen.has(x.id) && gesehen.add(x.id));
  let zeile = 0, halbeOffen = false, zeilenHoehe = 0;
  return liste.map(x => {
    const b = bausteine[x.id];
    const h = ganz(x.h, 1, 30, b.h || 6);
    if (Number.isFinite(x.x) && Number.isFinite(x.y) && Number.isFinite(x.w)) {
      const w = ganz(x.w, 1, SPALTEN, 6);
      return { id: x.id, x: ganz(x.x, 0, SPALTEN - w, 0), y: ganz(x.y, 0, 500, 0), w, h };
    }
    if (x.breit) {
      if (halbeOffen) { zeile += zeilenHoehe; halbeOffen = false; }
      const platz = { id: x.id, x: 0, y: zeile, w: SPALTEN, h };
      zeile += h;
      return platz;
    }
    if (halbeOffen) {
      const platz = { id: x.id, x: SPALTEN / 2, y: zeile, w: SPALTEN / 2, h };
      zeile += Math.max(zeilenHoehe, h); halbeOffen = false;
      return platz;
    }
    halbeOffen = true; zeilenHoehe = h;
    return { id: x.id, x: 0, y: zeile, w: SPALTEN / 2, h };
  });
}

// Vergleichswert eines Layouts: unverändert -> nur die Inhalte auffrischen
const signatur = (layout, bearbeiten) => layout.map(x => `${x.id}:${x.x},${x.y},${x.w},${x.h}`).sort().join('|') + (bearbeiten ? '#b' : '');

function inhalteZeichnen(root, bausteine, layout) {
  layout.forEach(x => {
    const el = root.querySelector(`[data-w-id="${x.id}"] .ko-w-inhalt`);
    if (!el) return;
    el.innerHTML = bausteine[x.id].inhalt();
    if (bausteine[x.id].danach) bausteine[x.id].danach(el);
  });
}

// root: Container; layout: bereinigtes Layout; bearbeiten: Modus an/aus
// onLayout(neuesLayout): Nutzer hat etwas geändert
export function renderDashboard(root, { bausteine, layout, bearbeiten, onLayout }) {
  const sig = signatur(layout, bearbeiten);
  const alt = root._dash;
  if (alt && alt.sig === sig && root.contains(alt.raster)) {
    alt.onLayout = onLayout;
    alt.layout = layout;
    inhalteZeichnen(root, bausteine, layout);
    return;
  }
  if (alt) { alt.beobachter?.disconnect(); alt.grid?.destroy(false); root._dash = null; }

  const werkzeug = (id) => `<button type="button" class="ko-w-btn is-warn" data-w-akt="weg" data-w="${id}" title="Ausblenden" aria-label="Baustein ausblenden"><span class="material-symbols-rounded icon" aria-hidden="true">close</span></button>`;
  const karten = layout.map(x => {
    const b = bausteine[x.id];
    // Bearbeiten: am Kopf ziehen (Maus und Finger), an Rand und Ecken die Größe ändern
    const griff = bearbeiten ? '<span class="ko-w-griff" title="Ziehen zum Verschieben" aria-hidden="true"><span class="material-symbols-rounded icon">drag_indicator</span></span>' : '';
    const kopf = `<div class="ko-card-head">${griff}<h3><span class="material-symbols-rounded icon" aria-hidden="true">${b.icon}</span>${esc(b.titel)}</h3>${bearbeiten ? werkzeug(x.id) : (b.aktion || '')}</div>`;
    // rahmenlose Bausteine (Kennzahlen) zeigen den Kopf nur im Bearbeiten-Modus
    const rahmenlos = b.rahmenlos && !bearbeiten;
    return `<div class="grid-stack-item" gs-id="${x.id}" gs-x="${x.x}" gs-y="${x.y}" gs-w="${x.w}" gs-h="${x.h}">
        <section class="grid-stack-item-content ko-w${rahmenlos ? ' is-rahmenlos' : ' ko-card'}${bearbeiten ? ' is-bearbeiten' : ''}" data-w-id="${x.id}" aria-label="${esc(b.titel)}">
        ${rahmenlos ? '' : kopf}<div class="ko-w-inhalt"></div></section></div>`;
  }).join('');

  const fehlend = Object.entries(bausteine).filter(([id]) => !layout.some(x => x.id === id));
  const hinzu = bearbeiten ? `<section class="ko-w-hinzu" aria-label="Bausteine hinzufügen">
      <h3>Weitere Bausteine</h3>
      ${fehlend.length ? `<div class="ko-w-auswahl">${fehlend.map(([id, b]) => `<button type="button" class="ko-w-neu" data-w-akt="dazu" data-w="${id}">
          <span class="material-symbols-rounded icon" aria-hidden="true">${b.icon}</span>
          <span class="ko-w-neu-text"><b>${esc(b.titel)}</b><small>${esc(b.text)}</small></span>
          <span class="material-symbols-rounded icon ko-w-neu-plus" aria-hidden="true">add</span></button>`).join('')}</div>`
        : '<p class="ko-w-leer">Alle Bausteine sind eingeblendet.</p>'}
    </section>` : '';

  root.classList.toggle('is-bearbeiten', !!bearbeiten);
  root.innerHTML = (layout.length ? `<div class="grid-stack ko-dash-raster">${karten}</div>`
    : '<div class="ko-empty"><span class="material-symbols-rounded icon" aria-hidden="true">space_dashboard</span><p><strong>Keine Bausteine eingeblendet</strong><br>Über „Anpassen“ stellst du dir die Übersicht zusammen.</p></div>') + hinzu;

  const raster = root.querySelector('.grid-stack');
  const zustand = root._dash = { sig, raster, onLayout, layout, grid: null, beobachter: null };
  if (raster) {
    const grid = zustand.grid = GridStack.init({
      column: SPALTEN, cellHeight: ZEILE, margin: ABSTAND, mode: 'float', animate: true,
      staticGrid: !bearbeiten, handle: '.ko-card-head', alwaysShowResizeHandle: true,
      resizable: { handles: 'e,se,s,sw,w' }
    }, raster);
    // schmaler Platz: eine Spalte, Bausteine in Lesereihenfolge untereinander.
    // gridstack merkt sich das 12er-Raster und stellt es bei mehr Platz wieder her.
    const spalten = () => (raster.clientWidth < SCHMAL ? 1 : SPALTEN);
    const anpassen = () => {
      if (!raster.clientWidth) return; // ausgeblendet
      const c = spalten();
      // hinunter: in Lesereihenfolge stapeln; hinauf: gemerkte Plätze (nicht 'list', das würde zusammenschieben)
      if (c !== grid.getColumn()) grid.column(c, c === 1 ? 'list' : undefined);
    };
    anpassen();
    if (typeof ResizeObserver !== 'undefined') { zustand.beobachter = new ResizeObserver(anpassen); zustand.beobachter.observe(raster); }
    grid.on('change', () => {
      if (!bearbeiten) return;
      // immer als 12er-Raster speichern, auch wenn gerade einspaltig bearbeitet wird
      const neu = layoutBereinigen(grid.save(false, false, undefined, SPALTEN).map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })), bausteine, []);
      zustand.sig = signatur(neu, bearbeiten);
      zustand.layout = neu;
      zustand.onLayout(neu);
    });
  }
  inhalteZeichnen(root, bausteine, layout);

  root.onclick = (e) => {
    const btn = e.target.closest('[data-w-akt]');
    if (!btn || !bearbeiten) return;
    const id = btn.dataset.w;
    const akt = btn.dataset.wAkt;
    const layout = zustand.layout;
    if (akt === 'dazu') {
      const b = bausteine[id];
      const w = ganz(b.w, 1, SPALTEN, 6);
      zustand.onLayout([...layout, { id, x: 0, y: unterkante(layout), w, h: ganz(b.h, 1, 30, 6) }]);
    } else if (akt === 'weg') zustand.onLayout(layout.filter(x => x.id !== id));
  };
}

// "Lücken schließen": alle Bausteine so weit wie möglich nach oben rücken
export function dashboardLueckenSchliessen(root) {
  const grid = root._dash?.grid;
  if (grid) grid.compact();
}
