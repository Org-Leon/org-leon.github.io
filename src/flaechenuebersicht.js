// Flächenübersicht als eigene Ansicht (#uebersicht-view): Kennzahlen,
// Kulturarten (Ring + Balken), Herkunft, größte Flächen und eine filter-/
// sortier-/durchsuchbare Tabelle aller Flächen. Gleiche Zahlen wie die
// Übersichtsseite der Gesamtübersicht (Daten aus collectGesamtFlaechen/
// summarizeGesamtKulturen in main.js), gleiche Kulturfarben.
//
// Animationen nur beim Öffnen (animate: true): Kacheln schweben gestaffelt
// ein, Zahlen zählen hoch, der Ring zeichnet sich, Balken wachsen,
// Tabellenzeilen blenden nacheinander ein. Bei "weniger Bewegung"
// (prefers-reduced-motion) alles sofort im Endzustand.

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  data: null,        // { rows, kulturen, teilflaechen, totalHa }
  filterKultur: null,
  search: '',
  sort: { key: 'ha', dir: -1 },
  onRowClick: null
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function ha(n, d = 2) {
  return (Number.isFinite(n) ? n : 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function pct(part, total) {
  if (!total) return '0 %';
  const v = part / total * 100;
  return v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 ? 1 : 0 }) + ' %';
}
// Einzelfläche: Größe aus der Shapedatei mit bis zu vier Nachkommastellen
// (qm-genau); aus der Geometrie berechnete Größen bleiben bei zwei.
function haRow(r) {
  if (r.computed) return ha(r.ha);
  return (Number.isFinite(r.ha) ? r.ha : 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
const kulturOf = (r) => r.kultur || 'Ohne Angabe';

// Zahl von 0 hochzählen (easeOutCubic).
export function countUp(el, target, { decimals = 0, duration = 900, delay = 0 } = {}) {
  const fmt = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (reduceMotion()) { el.textContent = fmt(target); return; }
  el.textContent = fmt(0);
  const start = performance.now() + delay;
  const step = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Nach dem ersten Frame den Endzustand setzen — CSS-Übergänge (Balken,
// Ring) laufen dann von 0 aus los.
function afterPaint(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function renderKpis(container, d, animate) {
  const { rows, kulturen, totalHa } = d;
  const drawn = rows.filter(r => r.isDrawn);
  const named = kulturen.all.filter(k => k.label !== 'Ohne Angabe');
  const namedKulturen = named.length;
  const tiles = [
    { label: 'Gesamtfläche', value: totalHa, decimals: 2, unit: 'ha', sub: `${rows.length} ${rows.length === 1 ? 'Fläche' : 'Flächen'}`, primary: true, icon: 'crop_square' },
    { label: 'Kulturarten', value: namedKulturen, decimals: 0, sub: named[0] ? `größte: ${named[0].label}` : 'keine Angaben in den Daten', icon: 'grass' },
    { label: 'Ø Flächengröße', value: rows.length ? totalHa / rows.length : 0, decimals: 2, unit: 'ha', sub: rows.length ? `größte ${ha(Math.max(...rows.map(r => r.ha)))} ha` : '', icon: 'straighten' },
    { label: 'Davon gezeichnet', value: drawn.reduce((s, r) => s + r.ha, 0), decimals: 2, unit: 'ha', sub: `${drawn.length} ${drawn.length === 1 ? 'Fläche' : 'Flächen'} im Flächenzeichner`, icon: 'draw' }
  ];
  container.innerHTML = tiles.map((t, i) => `
    <div class="ue-kpi${t.primary ? ' primary' : ''}${animate ? ' ue-anim' : ''}" style="--i:${i}">
      <span class="material-symbols-rounded icon ue-kpi-icon" aria-hidden="true">${t.icon}</span>
      <span class="ue-kpi-label">${esc(t.label)}</span>
      <span class="ue-kpi-value"><span class="ue-count" data-i="${i}">0</span>${t.unit ? `<small>${t.unit}</small>` : ''}</span>
      <span class="ue-kpi-sub">${esc(t.sub)}</span>
    </div>`).join('');
  container.querySelectorAll('.ue-count').forEach(el => {
    const t = tiles[+el.dataset.i];
    if (animate) countUp(el, t.value, { decimals: t.decimals, delay: 120 + +el.dataset.i * 70 });
    else el.textContent = t.value.toLocaleString('de-DE', { minimumFractionDigits: t.decimals, maximumFractionDigits: t.decimals });
  });
}

// Ring-Diagramm (SVG): jedes Segment ein Kreis mit stroke-dasharray.
function renderDonut(container, d, animate) {
  const { kulturen, totalHa } = d;
  const r = 70, C = 2 * Math.PI * r;
  let offset = 0;
  const gap = kulturen.shown.length > 1 ? 1.5 : 0;
  const segs = kulturen.shown.map((k, i) => {
    const len = totalHa ? (k.value / totalHa) * C : 0;
    const seg = { k, i, len: Math.max(0, len - gap), offset };
    offset += len;
    return seg;
  });
  container.innerHTML = `
    <svg viewBox="0 0 180 180" class="ue-donut-svg" role="img" aria-label="Flächenanteile nach Kulturart">
      <circle cx="90" cy="90" r="${r}" class="ue-donut-track"></circle>
      ${segs.map(s => `<circle cx="90" cy="90" r="${r}" class="ue-donut-seg${state.filterKultur === s.k.label ? ' active' : ''}" data-kultur="${esc(s.k.label)}"
          stroke="${s.k.color}" stroke-dasharray="${animate ? `0 ${C}` : `${s.len} ${C - s.len}`}" data-len="${s.len}" data-c="${C}"
          stroke-dashoffset="${-s.offset}" style="transition-delay:${animate ? 250 + s.i * 90 : 0}ms"><title>${esc(s.k.label)}: ${ha(s.k.value)} ha</title></circle>`).join('')}
    </svg>
    <div class="ue-donut-center">
      <span class="ue-donut-value" id="ue-donut-value">${ha(totalHa)}</span>
      <span class="ue-donut-unit" id="ue-donut-label">ha gesamt</span>
    </div>`;
  if (animate) {
    afterPaint(() => container.querySelectorAll('.ue-donut-seg').forEach(c => {
      const len = +c.dataset.len, Cc = +c.dataset.c;
      c.setAttribute('stroke-dasharray', `${len} ${Cc - len}`);
    }));
  }
  // Hover: Mitte zeigt die Kultur
  const valueEl = container.querySelector('#ue-donut-value');
  const labelEl = container.querySelector('#ue-donut-label');
  container.querySelectorAll('.ue-donut-seg').forEach(c => {
    const k = kulturen.shown.find(x => x.label === c.dataset.kultur);
    c.addEventListener('mouseenter', () => { valueEl.textContent = ha(k.value); labelEl.textContent = k.label; });
    c.addEventListener('mouseleave', () => { valueEl.textContent = ha(totalHa); labelEl.textContent = 'ha gesamt'; });
    c.addEventListener('click', () => toggleFilter(k.label));
  });
}

// Kulturarten summiert. Die Zeilen sind markierbar (Text kopieren per
// Rechtsklick/Strg+C) — darum kein <button> (Buttons lassen sich nicht
// markieren), sondern role="button"; ein Klick filtert nur, wenn dabei
// nichts markiert wurde. Kopiert wird als Tabelle mit Tabulatoren
// (Kulturart, Flächen, ha, Anteil), damit es in Excel in Spalten landet.
function kulturCopyLine(k, totalHa) {
  return [k.label, k.count, ha(k.value), pct(k.value, totalHa)].join('\t');
}
const KULTUR_COPY_HEADER = ['Kulturart', 'Flächen', 'Fläche (ha)', 'Anteil'].join('\t');
function hasTextSelection() {
  const sel = window.getSelection();
  return !!(sel && !sel.isCollapsed && sel.toString().trim());
}

function renderKulturBars(container, d, animate) {
  const { kulturen, totalHa } = d;
  const max = Math.max(...kulturen.shown.map(k => k.value), 0.0001);
  container.innerHTML = kulturen.shown.map((k, i) => `
    <div role="button" tabindex="0" class="ue-bar-row${state.filterKultur === k.label ? ' active' : ''}${animate ? ' ue-anim' : ''}" style="--i:${i + 2}" data-kultur="${esc(k.label)}" data-idx="${i}" title="${esc(k.label)} — antippen filtert die Tabelle, Text lässt sich markieren und kopieren">
      <span class="ue-bar-swatch" style="background:${k.color}"></span>
      <span class="ue-bar-label">${esc(k.label)}<small>${k.count} ${k.count === 1 ? 'Fläche' : 'Flächen'}</small></span>
      <span class="ue-bar-track"><span class="ue-bar-fill" style="background:${k.color}; width:${animate ? 0 : (k.value / max) * 100}%; transition-delay:${animate ? 300 + i * 70 : 0}ms" data-w="${(k.value / max) * 100}"></span></span>
      <span class="ue-bar-value">${ha(k.value)} ha</span>
      <span class="ue-bar-pct">${pct(k.value, totalHa)}</span>
    </div>`).join('');
  if (animate) afterPaint(() => container.querySelectorAll('.ue-bar-fill').forEach(el => { el.style.width = el.dataset.w + '%'; }));
  container.querySelectorAll('.ue-bar-row').forEach(b => {
    b.addEventListener('click', () => { if (!hasTextSelection()) toggleFilter(b.dataset.kultur); });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFilter(b.dataset.kultur); }
    });
  });
  // Markierte Zeilen sauber als Tabelle kopieren (statt Rohtext mit
  // Zeilenumbrüchen zwischen jedem Feld).
  container.oncopy = (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const rows = [...container.querySelectorAll('.ue-bar-row')].filter(r => sel.containsNode(r, true));
    if (!rows.length) return;
    // Nur ein Stück Text innerhalb einer Zeile: so lassen, wie markiert.
    if (rows.length === 1 && !sel.containsNode(rows[0], false) && sel.toString().trim().split(/\s+/).length < 3) return;
    const lines = rows.map(r => kulturCopyLine(kulturen.shown[+r.dataset.idx], totalHa));
    e.clipboardData.setData('text/plain', (rows.length > 1 ? KULTUR_COPY_HEADER + '\n' : '') + lines.join('\n'));
    e.preventDefault();
  };
}

function renderHerkunft(container, d, animate) {
  const bySource = new Map();
  d.rows.forEach(r => {
    const key = r.isDrawn ? 'Flächenzeichner' : r.quelle;
    const cur = bySource.get(key) || { n: 0, ha: 0, drawn: r.isDrawn };
    cur.n++; cur.ha += r.ha;
    bySource.set(key, cur);
  });
  container.innerHTML = [...bySource.entries()].map(([name, s], i) => `
    <div class="ue-source${animate ? ' ue-anim' : ''}" style="--i:${i + 4}">
      <span class="material-symbols-rounded icon" aria-hidden="true">${s.drawn ? 'draw' : 'upload_file'}</span>
      <span class="ue-source-name" title="${esc(name)}">${esc(name)}</span>
      <span class="ue-source-meta">${s.n} ${s.n === 1 ? 'Fläche' : 'Flächen'} · <strong>${ha(s.ha)} ha</strong></span>
      <span class="ue-source-bar"><span style="width:${d.totalHa ? (s.ha / d.totalHa) * 100 : 0}%"></span></span>
    </div>`).join('');
}

function renderTop(container, d, animate) {
  const top = [...d.rows].sort((a, b) => b.ha - a.ha).slice(0, 5);
  const color = (r) => d.kulturen.colorOf.get(kulturOf(r)) || '#B8BFB2';
  container.innerHTML = top.map((r, i) => `
    <li class="ue-top-item${animate ? ' ue-anim' : ''}" style="--i:${i + 5}" data-id="${esc(r.id)}" title="Auf der Karte zeigen">
      <span class="ue-top-rank">${i + 1}</span>
      <span class="ue-top-name">${esc([r.nummer, r.name].filter(Boolean).join(' – ') || 'Ohne Bezeichnung')}<small><span class="ue-dot" style="background:${color(r)}"></span>${esc(kulturOf(r))}</small></span>
      <span class="ue-top-ha">${haRow(r)} ha</span>
    </li>`).join('');
  container.querySelectorAll('.ue-top-item').forEach(li => li.addEventListener('click', () => state.onRowClick && state.onRowClick(li.dataset.id)));
}

const COLUMNS = [
  { key: 'nummer', label: 'Nr.' },
  { key: 'name', label: 'Name' },
  { key: 'kultur', label: 'Kulturart' },
  { key: 'flaechenId', label: 'Flächen-ID' },
  { key: 'quelle', label: 'Herkunft' },
  { key: 'ha', label: 'Größe (ha)', num: true }
];

function filteredRows() {
  const d = state.data;
  const q = state.search.trim().toLowerCase();
  let rows = d.rows.filter(r => !state.filterKultur || kulturOf(r) === state.filterKultur ||
    (state.filterKultur.startsWith('Weitere') && !d.kulturen.shown.some(k => k.label === kulturOf(r))));
  if (q) rows = rows.filter(r => [r.nummer, r.name, r.kultur, r.flaechenId, r.quelle].some(v => String(v || '').toLowerCase().includes(q)));
  const { key, dir } = state.sort;
  return rows.slice().sort((a, b) => {
    const av = key === 'kultur' ? kulturOf(a) : a[key], bv = key === 'kultur' ? kulturOf(b) : b[key];
    if (typeof av === 'number') return (av - bv) * dir;
    return String(av || '').localeCompare(String(bv || ''), 'de', { numeric: true }) * dir;
  });
}

function renderTable(animate) {
  const d = state.data;
  const rows = filteredRows();
  const thead = document.querySelector('#ue-table thead');
  thead.innerHTML = `<tr>${COLUMNS.map(c => `<th class="${c.num ? 'num' : ''}"><button type="button" data-sort="${c.key}" class="${state.sort.key === c.key ? 'sorted' : ''}">${c.label}<span class="material-symbols-rounded icon" aria-hidden="true">${state.sort.key === c.key ? (state.sort.dir > 0 ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}</span></button></th>`).join('')}</tr>`;
  const color = (r) => d.kulturen.colorOf.get(kulturOf(r)) || '#B8BFB2';
  document.querySelector('#ue-table tbody').innerHTML = rows.map((r, i) => `
    <tr data-id="${esc(r.id)}" class="${animate && i < 30 ? 'ue-row-anim' : ''}" style="--i:${Math.min(i, 30)}" title="Auf der Karte zeigen">
      <td>${esc(r.nummer || '–')}</td>
      <td>${esc(r.name || '–')}</td>
      <td><span class="ue-dot" style="background:${color(r)}"></span>${esc(kulturOf(r))}</td>
      <td>${esc(r.flaechenId || '–')}</td>
      <td>${r.isDrawn ? '<span class="ue-tag">Gezeichnet</span>' : esc(r.quelle)}</td>
      <td class="num">${haRow(r)}${r.computed ? '<sup title="aus der Geometrie berechnet">*</sup>' : ''}</td>
    </tr>`).join('') || `<tr><td colspan="${COLUMNS.length}" class="ue-table-empty">Keine Fläche passt zum Filter.</td></tr>`;
  const sum = rows.reduce((s, r) => s + r.ha, 0);
  document.querySelector('#ue-table tfoot').innerHTML = `<tr><td colspan="${COLUMNS.length - 1}">Summe · ${rows.length} ${rows.length === 1 ? 'Fläche' : 'Flächen'}${rows.length !== d.rows.length ? ` von ${d.rows.length}` : ''}</td><td class="num">${ha(sum)}</td></tr>`;
  document.querySelectorAll('#ue-table thead [data-sort]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.sort;
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'ha' ? -1 : 1 };
    renderTable(false);
  }));
  document.querySelectorAll('#ue-table tbody tr[data-id]').forEach(tr => tr.addEventListener('click', () => state.onRowClick && state.onRowClick(tr.dataset.id)));

  const chip = document.getElementById('ue-filter');
  chip.hidden = !state.filterKultur;
  if (state.filterKultur) {
    const k = d.kulturen.shown.find(x => x.label === state.filterKultur);
    chip.innerHTML = `<span class="ue-dot" style="background:${k ? k.color : '#B8BFB2'}"></span>${esc(state.filterKultur)}<span class="material-symbols-rounded icon" aria-hidden="true">close</span>`;
  }
}

function toggleFilter(label) {
  state.filterKultur = state.filterKultur === label ? null : label;
  document.querySelectorAll('#uebersicht-view [data-kultur]').forEach(el => el.classList.toggle('active', el.dataset.kultur === state.filterKultur));
  renderTable(false);
  if (state.filterKultur) document.getElementById('ue-table-card').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
}

let wired = false;
function wireOnce() {
  if (wired) return;
  wired = true;
  document.getElementById('ue-search').addEventListener('input', (e) => { state.search = e.target.value; renderTable(false); });
  document.getElementById('ue-filter').addEventListener('click', () => toggleFilter(state.filterKultur));
}

// data: { rows, kulturen, teilflaechen }, opts: { animate, onRowClick }
export function renderFlaechenuebersicht(data, { animate = false, onRowClick = null, subtitle = '' } = {}) {
  wireOnce();
  const totalHa = data.rows.reduce((s, r) => s + r.ha, 0);
  state.data = { ...data, totalHa };
  state.onRowClick = onRowClick;
  if (state.filterKultur && !data.kulturen.shown.some(k => k.label === state.filterKultur)) state.filterKultur = null;
  const anim = animate && !reduceMotion();

  document.getElementById('ue-subtitle').textContent = subtitle;
  const empty = !data.rows.length;
  document.getElementById('ue-empty').hidden = !empty;
  document.getElementById('ue-content').hidden = empty;
  const view = document.getElementById('uebersicht-view');
  view.classList.toggle('ue-animating', anim);
  if (empty) return;

  renderKpis(document.getElementById('ue-kpis'), state.data, anim);
  renderDonut(document.getElementById('ue-donut'), state.data, anim);
  renderKulturBars(document.getElementById('ue-kulturen'), state.data, anim);
  renderHerkunft(document.getElementById('ue-herkunft'), state.data, anim);
  renderTop(document.getElementById('ue-top'), state.data, anim);
  renderTable(anim);

  const notes = [];
  if (data.rows.some(r => r.computed)) notes.push('* Größe aus der Geometrie berechnet (keine Angabe in der Shapedatei).');
  if (data.teilflaechen) notes.push(`${data.teilflaechen} Fläche(n) aus Zusatzebenen (Teilflächen, Gewässerrandstreifen) sind nicht mitgezählt, da sie in anderen Flächen liegen.`);
  document.getElementById('ue-notes').textContent = notes.join(' ');
  document.getElementById('ue-notes').hidden = !notes.length;
}
