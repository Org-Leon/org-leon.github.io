// ---------- Schlagliste (Umstellung) ----------
// Gleicht eine extern geführte Schlagliste (Excel "Felder & Kulturen") mit den
// Flächen eines im Jahresvergleich hinterlegten Jahres ab, berechnet je Fläche
// den Umstellungsstatus (1. Jahr konventionell, 2. Jahr Umstellung, ab dem
// 3. Jahr ökologisch) und baut die Liste für den Wiederimport im gleichen
// Format zurück. Reine Logik ohne Oberfläche (die steckt in main.js,
// Abschnitt "Schlagliste").
//
// Spalten der Liste: PK Feld / PK Kultur sind die Primärschlüssel des
// externen Programms (Feldstück dauerhaft, Kultur-Eintrag je Anbaujahr) —
// sie gehen unverändert zurück, damit der Import Zeilen aktualisiert statt
// neue anzulegen. Neue Flächen bekommen leere Schlüssel.

export const SL_SPALTEN = {
  kunde: 'Kundennummer', pkFeld: 'PK Feld', pkKultur: 'PK Kultur', schlagnr: 'Schlagnummer',
  bez: 'Bezeichnung', flik: 'Flächenidentifikationsnummer', kategorie: 'Kategorie', kultur: 'Kultur',
  ha: 'ha', land: 'Land', bundesland: 'Bundesland', zugang: 'Zugang Fläche', abgang: 'Abgang Fläche',
  status: 'Status Feldstück', besichtigt: 'Fläche besichtigt im Jahr', importInfo: 'Import Information'
};
// Bezeichnungen der drei Stufen im externen Programm — einstellbar, weil sie
// beim Wiederimport wörtlich stimmen müssen.
// 1. Jahr wörtlich wie im Intact-Export gesehen; 2. Jahr noch nicht gesehen (Annahme).
export const SL_STATUS_STANDARD = { konv: 'Nichtökologische Erzeugnisse (aus dem 1. Umstellungsjahr)', umst: 'Umstellungserzeugnisse', oeko: 'Ökologische Erzeugnisse' };
// Statustexte aus der Liste lernen: je Stufe (aus "Zugang Fläche" am Stichtag) der
// häufigste Text in "Status Feldstück". Liefert nur die Stufen, die vorkommen.
export function slStatusTexteLernen(sl, stichtag) {
  const zaehl = { konv: new Map(), umst: new Map(), oeko: new Map() };
  sl.rows.forEach(r => {
    const z = slZeile(sl, r);
    const st = slStufe(z.zugang, stichtag);
    if (!st || !z.status || z.abgang) return;
    zaehl[st.key].set(z.status, (zaehl[st.key].get(z.status) || 0) + 1);
  });
  const out = {};
  Object.entries(zaehl).forEach(([k, m]) => { const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0]; if (best) out[k] = best[0]; });
  return out;
}
export const SL_STUFEN = {
  konv: { kurz: 'konv.', label: '1. Jahr – konventionell' },
  umst: { kurz: 'Umstellung', label: '2. Jahr – Umstellung' },
  oeko: { kurz: 'Bio', label: 'ab 3. Jahr – ökologisch' }
};
// Ab dieser Punktzahl gilt eine Zuordnung als sicher, darunter prüft der Kontrolleur.
export const SL_SICHER = 75;
const SL_MIN = 25;

// ---- Datum ----
const pad = (n) => String(n).padStart(2, '0');
export function slIsoAusDe(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(s || '').trim());
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim()) ? String(s).trim() : null;
}
export const slDeAusIso = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const addMonths = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  return dt.toISOString().slice(0, 10);
};

// Umstellungsstatus am Stichtag, gezählt ab einem festen Datum (Umstellungsbeginn):
// unter 12 Monaten konventionell, 12–24 Monate Umstellung, ab 24 Monaten ökologisch.
export function slStufe(beginnIso, stichtagIso) {
  if (!beginnIso || !stichtagIso) return null;
  const umstAb = addMonths(beginnIso, 12), oekoAb = addMonths(beginnIso, 24);
  const key = stichtagIso < umstAb ? 'konv' : stichtagIso < oekoAb ? 'umst' : 'oeko';
  return { key, umstAb, oekoAb };
}

// ---- Einlesen ----
// aoa: Tabelle als Liste von Zeilen (XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })).
export function slParse(aoa) {
  const kopfIdx = aoa.findIndex(r => r.some(c => String(c).trim() === SL_SPALTEN.pkFeld || String(c).trim() === SL_SPALTEN.schlagnr));
  if (kopfIdx === -1) throw new Error('Keine Schlagliste erkannt — Spalten „PK Feld“ bzw. „Schlagnummer“ fehlen.');
  const header = aoa[kopfIdx].map(c => String(c).trim());
  const col = {};
  Object.entries(SL_SPALTEN).forEach(([k, name]) => { const i = header.indexOf(name); if (i !== -1) col[k] = i; });
  if (col.ha === undefined || (col.schlagnr === undefined && col.bez === undefined)) throw new Error('Spalten „ha“ und „Schlagnummer“/„Bezeichnung“ werden gebraucht.');
  const rows = aoa.slice(kopfIdx + 1)
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => header.map((_, i) => (r[i] === undefined || r[i] === null ? '' : r[i])));
  return { header, col, rows };
}

const ohneNullen = (s) => String(s || '').trim().replace(/^0+(?=\d)/, '');
export function slNormName(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
// Infos einer Listenzeile (für Abgleich und Anzeige)
// ---- FLIK ----
// Kern einer FLIK ohne Länderpräfix: "DETHLIAL49352V01" -> "AL49352V01",
// "DESTLI0502670020" -> "0502670020". Land: "TH", "ST", "BY" …
const FLIK_PRAEFIX = /^DE([A-Z]{2})LI/;
export const slFlikKern = (flik) => String(flik || '').toUpperCase().replace(/\s+/g, '').replace(FLIK_PRAEFIX, '');
export const slFlikLand = (flik) => (FLIK_PRAEFIX.exec(String(flik || '').toUpperCase()) || [])[1] || '';
// FLIK-artige Wörter aus einer Bezeichnung ("77 AL49352V01", "39 AL49363D02/1", "DETHLIAL…")
function flikTokens(text) {
  const out = new Set();
  String(text || '').toUpperCase().split(/[\s,;()]+/).forEach(w => {
    const m = /^(?:DE[A-Z]{2}LI)?([A-Z]{2}\d{5}[A-Z0-9]{3})(?:[\/.-]\d+)?$/.exec(w) || /^(?:DE[A-Z]{2}LI)?(\d{10})$/.exec(w);
    if (m) out.add(m[1]);
    // ohne Nutzungsart-Kürzel ("49352D12" statt "AL49352D12") -> mit "*" markiert
    const o = /^(\d{5}[A-Z]\d{2})(?:[\/.-]\d+)?$/.exec(w);
    if (o) out.add('*' + o[1]);
  });
  return [...out];
}
// Gleiche Länge, höchstens ein abweichendes Zeichen — nach dem Gleichsetzen
// typischer Verwechsler (I/1, O/0) — gilt als "FLIK ähnlich" (Tippfehler).
// Wie passt eine Listenzeile über die FLIK zu einer Fläche? 'gleich' | 'aehnlich' | 'gebiet' | null
export function slFlikPasst(z, f) {
  const kern = slFlikKern(f.flik);
  const tokens = (z && z.flikTokens) || [];
  if (!kern || !tokens.length) return null;
  if (tokens.some(t => t === kern || (t.startsWith('*') && t.slice(1) === kern.slice(2)))) return 'gleich';
  if (tokens.some(t => !t.startsWith('*') && flikAehnlich(t, kern))) return 'aehnlich';
  if (kern.length >= 10 && tokens.some(t => t.length === kern.length && t.slice(0, 7) === kern.slice(0, 7))) return 'gebiet';
  return null;
}
function flikAehnlich(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const n = (x) => x.replace(/I/g, '1').replace(/O/g, '0');
  const x = n(a), y = n(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && ++diff > 1) return false;
  return true;
}
const BUNDESLAND_KUERZEL = {
  'baden-württemberg': 'BW', bayern: 'BY', brandenburg: 'BB', hessen: 'HE', 'mecklenburg-vorpommern': 'MV', niedersachsen: 'NI',
  'nordrhein-westfalen': 'NW', 'rheinland-pfalz': 'RP', saarland: 'SL', sachsen: 'SN', 'sachsen-anhalt': 'ST', 'schleswig-holstein': 'SH', 'thüringen': 'TH'
};
const LANDSCHAFTSELEMENT = /hecke|baumreihe|geh(ö|oe)lz|feldrain|landschaftselement|biotop/i;

export function slZeile(sl, row) {
  const g = (k) => (sl.col[k] === undefined ? '' : row[sl.col[k]]);
  const bez = String(g('bez') || '').trim();
  const m = /^(\d+)\s+(.*)$/.exec(bez);
  const haRoh = g('ha');
  const ha = haRoh === '' ? null : parseFloat(String(haRoh).replace(',', '.'));
  const flik = String(g('flik') || '').trim();
  // alle Schlag-/Teilschlagnummern in der Bezeichnung ("8 8.1 …", "… (82.1)"), ohne FLIK-Bestandteile
  const nummern = (bez.match(/(?:^|[\s(])(\d+(?:\.\d+)*)(?=[\s)]|$)/g) || []).map(x => ohneNullen(x.replace(/[\s(]/g, '')));
  return {
    nr: ohneNullen(g('schlagnr')), bez, bezNr: m ? ohneNullen(m[1]) : '', name: m ? m[2].trim() : bez,
    nummern, flikTokens: [...new Set([...(flik ? [slFlikKern(flik)] : []), ...flikTokens(bez)])],
    land: BUNDESLAND_KUERZEL[String(g('bundesland') || '').trim().toLowerCase()] || '',
    ha: isFinite(ha) ? ha : null, flik,
    zugang: slIsoAusDe(g('zugang')), abgang: slIsoAusDe(g('abgang')), status: String(g('status') || '').trim(),
    kultur: String(g('kultur') || '').trim()
  };
}
// Zeile ohne verwertbare Angaben (nur Schlüssel) — bleibt beim Export unverändert.
export const slUnvollstaendig = (z) => !z.bez && z.ha === null;

// ---- Abgleich ----
function bigrams(s) { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; }
export function slNameAehnlich(a, b) {
  const x = slNormName(a).replace(/ /g, ''), y = slNormName(b).replace(/ /g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const bx = bigrams(x), by = bigrams(y);
  const rest = [...by];
  let hit = 0;
  bx.forEach(g => { const i = rest.indexOf(g); if (i !== -1) { hit++; rest.splice(i, 1); } });
  return (2 * hit) / (bx.length + by.length || 1);
}
// Punkte für ein Paar Listenzeile ↔ Fläche, mit Begründung.
// f: { nummer, name, ha, flik }; umnummeriert: Map alte Nr -> neue Nr (aus dem Vorjahr, geometrisch erkannt)
// opts.nrVerlaesslich: false, wenn die Schlagnummer der Liste eine interne
// Zählung ist (passt in der Liste nicht zur Nummer in der Bezeichnung)
export function slBewerte(z, f, umnummeriert, { nrVerlaesslich = true } = {}) {
  let p = 0;
  const gruende = [];
  const fnr = ohneNullen(f.nummer);
  const flik = slFlikPasst(z, f);
  if (flik === 'gleich') { p += 60; gruende.push('FLIK gleich'); }
  else if (flik === 'aehnlich') { p += 45; gruende.push('FLIK ähnlich (Tippfehler?)'); }
  else if (flik === 'gebiet') { p += 15; gruende.push('FLIK-Gebiet gleich'); }
  const zNummern = z.nummern || [];
  const letzteNr = zNummern[zNummern.length - 1];
  if (nrVerlaesslich && z.nr && z.nr === fnr) { p += 40; gruende.push('Nummer gleich'); }
  else if (fnr && letzteNr === fnr && letzteNr !== z.bezNr) { p += 35; gruende.push('Teilschlag aus Bezeichnung'); }
  else if (z.bezNr && z.bezNr === fnr) { p += 30; gruende.push('Nummer aus Bezeichnung'); }
  else if (fnr && zNummern.includes(fnr)) { p += 25; gruende.push('Nummer aus Bezeichnung'); }
  else if (umnummeriert && (umnummeriert.get(z.nr) === fnr || umnummeriert.get(z.bezNr) === fnr)) { p += 40; gruende.push('umnummeriert (Vorjahr)'); }
  const sim = slNameAehnlich(z.name, f.name);
  if (sim >= 0.85) { p += 30; gruende.push('Name gleich'); } else if (sim >= 0.6) { p += 15; gruende.push('Name ähnlich'); }
  let haGleich = false;
  if (z.ha !== null && f.ha !== null && f.ha !== undefined) {
    const diff = Math.abs(z.ha - f.ha), rel = diff / Math.max(z.ha, f.ha, 0.0001);
    if (diff <= 0.01 || rel <= 0.005) { p += 25; gruende.push('Fläche gleich'); haGleich = true; }
    else if (rel <= 0.05) { p += 12; gruende.push('Fläche ähnlich'); }
    else if (rel > 0.2) { p -= 20; gruende.push('Fläche weicht stark ab'); }
    else gruende.push('Fläche weicht ab');
  }
  // Name bzw. Nummer und Größe passen beide genau: eindeutig genug
  const nummerPasst = gruende.some(g => /^(Nummer|Teilschlag|umnummeriert)/.test(g));
  if ((sim >= 0.85 || nummerPasst) && haGleich) p += 20;
  // anderes Bundesland (FLIK der Fläche vs. Spalte "Bundesland") -> sehr unwahrscheinlich
  const fLand = slFlikLand(f.flik);
  if (z.land && fLand && z.land !== fLand) { p -= 60; gruende.push('anderes Bundesland'); }
  // Landschaftselement (Hecke, Baumreihe …) passt nicht zu einer Kultur-Zeile
  if (f.le && !LANDSCHAFTSELEMENT.test(z.kultur + ' ' + z.bez)) { p -= 30; gruende.push('Landschaftselement'); }
  return { punkte: p, gruende };
}
// Ordnet Listenzeilen und Flächen einander zu (je höchste Punktzahl zuerst, jede nur einmal).
// feats: [{ key, nummer, name, ha, flik }]
// manuell: { [zeilenIdx]: featureKey | null }   (null = bewusst keine Fläche)
// zurPruefung: { [zeilenIdx]: true } — automatische Zuordnung trotzdem prüfen lassen
// Ergebnis: { zeilen: [{ idx, z, key, punkte, gruende, art }], neu: [feature], vorschlaege(idx) }
//   art: 'sicher' | 'pruefen' | 'manuell' | 'fehlt' | 'unvollstaendig'
export function slAbgleich(sl, feats, { manuell = {}, umnummeriert = null, zurPruefung = {} } = {}) {
  const zeilen = sl.rows.map((row, idx) => ({ idx, z: slZeile(sl, row), key: null, punkte: 0, gruende: [], art: 'fehlt' }));
  // Ist die Schlagnummer der Liste dieselbe Nummer wie vorn in der Bezeichnung?
  // Sonst ist sie eine interne Zählung des externen Programms und zählt nicht.
  const mitBeiden = zeilen.filter(e => e.z.nr && e.z.bezNr);
  const nrVerlaesslich = !mitBeiden.length || mitBeiden.filter(e => e.z.nr === e.z.bezNr).length / mitBeiden.length >= 0.5;
  const bewerte = (z, f) => slBewerte(z, f, umnummeriert, { nrVerlaesslich });
  const vergeben = new Set();
  const offen = [];
  zeilen.forEach(e => {
    if (slUnvollstaendig(e.z)) { e.art = 'unvollstaendig'; return; }
    if (Object.prototype.hasOwnProperty.call(manuell, e.idx)) {
      const key = manuell[e.idx];
      if (key && feats.some(f => f.key === key) && !vergeben.has(key)) { e.key = key; vergeben.add(key); e.art = 'manuell'; }
      else e.art = key ? 'fehlt' : 'abgang';
      return;
    }
    offen.push(e);
  });
  const paare = [];
  offen.forEach(e => feats.forEach(f => {
    if (vergeben.has(f.key)) return;
    const b = bewerte(e.z, f);
    if (b.punkte >= SL_MIN) paare.push({ e, f, ...b });
  }));
  paare.sort((a, b) => b.punkte - a.punkte);
  const belegt = new Set();
  paare.forEach(p => {
    if (belegt.has(p.e.idx) || vergeben.has(p.f.key)) return;
    belegt.add(p.e.idx); vergeben.add(p.f.key);
    // Sicher nur ohne Flächenabweichung — eine andere Größe soll der Kontrolleur sehen
    const sicher = p.punkte >= SL_SICHER && !zurPruefung[p.e.idx] && !p.gruende.some(g => g.startsWith('Fläche weicht'));
    Object.assign(p.e, { key: p.f.key, punkte: p.punkte, gruende: p.gruende, art: sicher ? 'sicher' : 'pruefen' });
  });
  const vorschlaege = (idx) => {
    const e = zeilen[idx];
    return feats.map(f => ({ f, ...bewerte(e.z, f) })).filter(x => x.punkte > 0).sort((a, b) => b.punkte - a.punkte);
  };
  return { zeilen, neu: feats.filter(f => !vergeben.has(f.key)), vorschlaege, nrVerlaesslich };
}

// ---- Export ----
// Baut die Tabelle (Kopf + Zeilen) für den Wiederimport.
// opts: { featByKey, stichtag, statusTexte, zugangNeu: {key: iso}, abgangAm: {idx: iso}, besichtigt: Set(keys),
//         unterflaechen: {key: { beginn: iso, ha }},
//         kulturFuer(key, zeileInfo) -> { kultur, kategorie } | null  (Kultur aus den Shapes, im Katalog des externen Programms) }
// Unterfläche = zur Fläche dazugekommenes Teilstück mit eigenem Umstellungsbeginn:
// eigene Zeile direkt unter der Fläche (gleiche Schlagnummer, Bezeichnung
// "… – Teilstück JJJJ", leere Schlüssel); die Fläche selbst behält nur den Rest.
export const slTeilstueckName = (bez, beginn) => `${bez} – Teilstück ${String(beginn || '').slice(0, 4)}`.trim();
export function slExportZeilen(sl, abgleich, opts) {
  const { featByKey, stichtag, statusTexte, zugangNeu = {}, abgangAm = {}, besichtigt = new Set(), unterflaechen = {}, kulturFuer = null } = opts;
  const setzeKultur = (row, key, zeileInfo) => {
    const k = kulturFuer && kulturFuer(key, zeileInfo);
    if (!k || !k.kultur) return;
    setze(row, 'kultur', k.kultur);
    if (k.kategorie) setze(row, 'kategorie', k.kategorie);
  };
  const c = sl.col;
  const nrBreite = Math.max(0, ...sl.rows.map(r => (c.schlagnr === undefined ? 0 : String(r[c.schlagnr] || '').length)));
  const fmtNr = (nr) => (/^\d+$/.test(nr) && nrBreite > String(nr).length ? String(nr).padStart(nrBreite, '0') : String(nr));
  const setze = (row, k, v) => { if (c[k] !== undefined) row[c[k]] = v; };
  const statusText = (beginn) => { const s = slStufe(beginn, stichtag); return s ? statusTexte[s.key] : null; };
  const jahr = stichtag.slice(0, 4);
  const rund = (ha) => Math.round(ha * 10000) / 10000;
  const unter = (key) => { const u = unterflaechen[key]; return u && u.beginn && u.ha > 0 ? u : null; };
  // Zeile für eine Unterfläche aus der Zeile ihrer Fläche ableiten
  const teilstueckZeile = (row, u, key) => {
    const t = [...row];
    ['pkFeld', 'pkKultur', 'abgang', 'importInfo', 'flik'].forEach(k => setze(t, k, ''));
    setze(t, 'bez', slTeilstueckName(c.bez === undefined ? '' : row[c.bez], u.beginn));
    setze(t, 'ha', rund(u.ha));
    setze(t, 'zugang', slDeAusIso(u.beginn));
    setze(t, 'status', statusText(u.beginn) || '');
    if (!besichtigt.has(key)) setze(t, 'besichtigt', '');
    return t;
  };
  const out = [];
  abgleich.zeilen.forEach(e => {
    const row = [...sl.rows[e.idx]];
    out.push(row);
    if (e.art === 'unvollstaendig') return;
    // Ungeprüfte Zweifelsfälle bleiben unverändert — erst nach Bestätigung übernehmen.
    if (e.key && e.art !== 'pruefen') {
      const f = featByKey.get(e.key);
      const fnr = ohneNullen(f.nummer);
      // Schlagnummer nur schreiben, wenn sie in der Liste die echte Schlagnummer ist (sonst interne Zählung)
      if (f.nummer && abgleich.nrVerlaesslich !== false) setze(row, 'schlagnr', fmtNr(fnr));
      // Nummer vorn in der Bezeichnung = alte Schlagnummer? Dann mit umnummerieren.
      const bezNr = e.z.bezNr && e.z.nr && e.z.bezNr === e.z.nr && fnr ? fnr : e.z.bezNr;
      const name = f.name && slNameAehnlich(e.z.name, f.name) < 1 ? f.name : e.z.name;
      if (bezNr !== e.z.bezNr || name !== e.z.name) setze(row, 'bez', (bezNr ? bezNr + ' ' : '') + name);
      const u = unter(e.key);
      if (f.ha !== null && f.ha !== undefined) setze(row, 'ha', rund(u ? f.ha - u.ha : f.ha));
      if (besichtigt.has(e.key)) setze(row, 'besichtigt', jahr);
      setzeKultur(row, e.key, e.z);
    }
    if (abgangAm[e.idx]) setze(row, 'abgang', slDeAusIso(abgangAm[e.idx]));
    const st = statusText(e.z.zugang);
    if (st && !abgangAm[e.idx]) setze(row, 'status', st);
    const u = e.key && e.art !== 'pruefen' ? unter(e.key) : null;
    if (u) out.push(teilstueckZeile(row, u, e.key));
  });
  // Neue Flächen (nur in den Shapes) mit eingetragenem Umstellungsbeginn anhängen
  const vorlage = sl.rows.find(r => c.kunde === undefined || String(r[c.kunde] || '').trim()) || [];
  abgleich.neu.forEach(f => {
    const beginn = zugangNeu[f.key];
    if (!beginn) return;
    const row = sl.header.map(() => '');
    ['kunde', 'land', 'bundesland'].forEach(k => setze(row, k, c[k] === undefined ? '' : vorlage[c[k]] || ''));
    if (abgleich.nrVerlaesslich !== false) setze(row, 'schlagnr', fmtNr(ohneNullen(f.nummer)));
    // Bezeichnung wie in der Liste üblich: Nummer + Name, sonst Nummer + FLIK-Kern
    setze(row, 'bez', [ohneNullen(f.nummer), f.name || slFlikKern(f.flik)].filter(Boolean).join(' '));
    setze(row, 'flik', f.flik || '');
    setze(row, 'kultur', '');
    setzeKultur(row, f.key, null);
    const u = unter(f.key);
    setze(row, 'ha', f.ha !== null && f.ha !== undefined ? rund(u ? f.ha - u.ha : f.ha) : '');
    setze(row, 'zugang', slDeAusIso(beginn));
    setze(row, 'status', statusText(beginn) || '');
    if (besichtigt.has(f.key)) setze(row, 'besichtigt', jahr);
    out.push(row);
    if (u) out.push(teilstueckZeile(row, u, f.key));
  });
  return [sl.header, ...out];
}
