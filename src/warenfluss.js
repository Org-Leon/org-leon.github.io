// ---------- Warenflussprüfung (Kontrolle) ----------
// Eigenständiges Modul wie flaechenuebersicht.js: Prüfbereiche (Pflanzenbau,
// Tierhaltung, Imkerei, Verarbeitung, Handel) mit Tabellen, die gegen
// recherchierte Referenzwerte rechnen (warenfluss-referenzen.js), plus ein
// vorformulierter Freitext. Eine Prüfung gehört zu einem Termin
// (ev.warenfluss, siehe main.js) und wird mit dem Termin gespeichert.
//
// Datenform einer Prüfung:
//   { id, modul, titel, zeitraum, modus: 'tabelle'|'text', tolErtrag, tolBilanz,
//     tables: { [tabelle]: [zeilen] }, freitext: string|null, createdAt, updatedAt,
//     mitBilanz: boolean (Mengenbilanz ein-/ausgeblendet),
//     stufen: [...] nur bei modul 'kette' (mehrstufiger Warenfluss, s. u.) }
// Zeilen tragen ihre Eingaben plus die übernommene Referenz
// (refTyp/refMin/refMax/refQuelle/refInfo/refEinheit) — überschreibbar.

import { WF_QUELLEN, WF_KULTUREN, WF_TIERE, WF_IMKEREI, WF_PROZESSE } from './warenfluss-referenzen.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Deutsche Eingaben: "1.234,5" oder "1234,5"; ohne Komma zählt der Punkt als Dezimalzeichen.
const num = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let str = String(v).replace(/\s/g, '');
  if (str.includes(',')) str = str.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n, d = 1) => (n == null || !Number.isFinite(n) ? '–' : n.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const fmtIn = (n) => (n == null ? '' : String(n).replace('.', ','));
const uid = () => 'wf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const WF_MODULE = {
  pflanzenbau: { label: 'Pflanzenbau', icon: 'grass', sub: 'Ernte, Ertrag je ha, Saatgut, Mengenbilanz' },
  tierhaltung: { label: 'Tierhaltung', icon: 'pets', sub: 'Leistung, Futterbedarf, Mengenbilanz' },
  imkerei: { label: 'Imkerei', icon: 'hive', sub: 'Honig je Volk, Mengenbilanz' },
  verarbeitung: { label: 'Verarbeitung', icon: 'handyman', sub: 'Ausbeute Rohware → Produkt, Mengenbilanz' },
  handel: { label: 'Handel', icon: 'compare_arrows', sub: 'Bestand, Zukauf, Verkauf, Schwund' },
  kette: { label: 'Warenflusskette', icon: 'account_tree', sub: 'Mehrstufig: Erzeugung → Verarbeitung → Verkauf' },
  bestand: { label: 'Bestandsentwicklung Rinder', icon: 'pets', sub: 'Aus dem HIT-Auszug: Bestand, Zugänge, Abgänge' }
};

// ---- Flächen aus der Flächenübersicht ----
// ctx.flaechen = [{ label, ha, count }] (Kulturen des Betriebs mit summierten
// Hektar, von main.js übergeben, wenn der Betrieb gewählt und Flächen geladen
// sind). Die Antragsdaten nennen Kulturen je Bundesland anders
// ("Winterweichweizen", "Sommerhafer", "Winterroggen, Winter-Waldstaudenroggen")
// — zugeordnet wird über Namensmuster. Kulturen ohne Muster (z. B.
// Grassilage, Sonstige) werden nicht automatisch gefüllt.
const WF_KULTUR_MUSTER = {
  winterweizen: /winter(weich)?weizen/i,
  dinkel: /dinkel/i,
  winterroggen: /winterroggen/i,
  wintertriticale: /triticale/i,
  wintergerste: /wintergerste/i,
  sommergerste: /sommergerste/i,
  hafer: /hafer/i,
  koernermais: /k(ö|oe)rnermais|\bccm\b/i,
  ackerbohne: /ackerbohne/i,
  futtererbse: /erbse/i,
  sojabohne: /soja/i,
  lupine: /lupine/i,
  sonnenblume: /sonnenblume/i,
  speisekartoffel: /kartoffel/i
};
const round4 = (n) => Math.round(n * 10000) / 10000;
// Summierte Fläche einer Prüf-Kultur aus der Flächenübersicht (oder null).
export function flaecheFuerKultur(flaechen, key) {
  const re = WF_KULTUR_MUSTER[key];
  if (!re || !Array.isArray(flaechen)) return null;
  const hits = flaechen.filter(f => re.test(f.label));
  if (!hits.length) return null;
  return { ha: round4(hits.reduce((s, f) => s + f.ha, 0)), count: hits.reduce((s, f) => s + f.count, 0), labels: hits.map(f => f.label) };
}
const flaecheInfo = (m) => `Flächenübersicht: ${m.labels.join(', ')} · ${m.count} ${m.count === 1 ? 'Fläche' : 'Flächen'}`;
// Beim Wählen der Kultur: Fläche übernehmen, solange sie nicht von Hand eingetragen wurde.
function fillFlaeche(row, key, field = 'flaeche') {
  const auto = field + 'Auto', info = field + 'Info';
  const m = state && flaecheFuerKultur(state.ctx.flaechen, key);
  if (!m) { if (row[auto]) { row[field] = null; row[auto] = false; row[info] = ''; } return; }
  if (row[field] != null && !row[auto]) return;
  row[field] = m.ha;
  row[auto] = true;
  row[info] = flaecheInfo(m);
}
const flaecheBadge = (info) => `<span class="wf-src wf-fl-src" title="${esc(info)} — überschreibbar">Flächenübersicht</span>`;

// ---- Bewertung ----
// Gegen Referenz: innerhalb Spanne (bzw. typ) ± Toleranz = plausibel, bis
// 1,5-fache Toleranz = prüfen, darüber = auffällig.
export function rateAgainstRef(value, row, tolPct) {
  const typ = num(row.refTyp), min = num(row.refMin), max = num(row.refMax);
  if (value == null || (typ == null && min == null && max == null)) return null;
  const lowBase = min ?? typ ?? max, highBase = max ?? typ ?? min;
  const t = (tolPct ?? 25) / 100;
  const dev = typ ? (value - typ) / typ * 100 : null;
  if (value >= lowBase * (1 - t) && value <= highBase * (1 + t)) return { level: 'ok', dev };
  if (value >= lowBase * (1 - 1.5 * t) && value <= highBase * (1 + 1.5 * t)) return { level: 'warn', dev };
  return { level: 'bad', dev };
}
function rateBilanz(diffPct, tolPct) {
  if (diffPct == null) return null;
  const a = Math.abs(diffPct), t = tolPct ?? 2;
  return { level: a <= t ? 'ok' : a <= 2 * t ? 'warn' : 'bad', dev: diffPct };
}
const LEVEL_TEXT = { ok: 'plausibel', warn: 'prüfen', bad: 'auffällig' };

// ---- Spalten-Bausteine ----
const refFrom = (r) => r ? { refTyp: r.typ ?? null, refMin: r.min ?? null, refMax: r.max ?? null, refQuelle: r.quelle || '', refInfo: r.info || '', refEinheit: r.einheit || '' } : { refTyp: null, refMin: null, refMax: null, refQuelle: '', refInfo: '', refEinheit: '' };

function bilanzTable(opts = {}) {
  const cols = [
    { key: 'produkt', label: 'Produkt / Ware', type: 'text', width: 150, placeholder: 'z. B. Winterweizen' },
    { key: 'einheit', label: 'Einheit', type: 'select', options: ['dt', 'kg', 't', 'l', 'Stück', 'Tiere'].map(v => ({ value: v, label: v })), width: 70 },
    { key: 'anfang', label: 'Anfangs­bestand', type: 'num' },
    ...(opts.noZugang ? [] : [{ key: 'zugang', label: opts.zugangLabel || 'Ernte / Erzeugung', type: 'num' }]),
    { key: 'zukauf', label: 'Zukauf (Bio-Belege)', type: 'num' },
    { key: 'verkauf', label: 'Verkauf / Abgabe', type: 'num' },
    { key: 'sonst', label: opts.sonstLabel || 'Eigenverbrauch / Verluste', type: 'num' },
    { key: 'ende', label: 'Endbestand (Inventur)', type: 'num' },
    { key: 'soll', label: 'Soll-Endbestand', type: 'calc', calc: r => {
      const parts = [r.anfang, r.zugang, r.zukauf].map(num), out = [r.verkauf, r.sonst].map(num);
      if ([...parts, ...out].every(v => v == null)) return null;
      return parts.reduce((s, v) => s + (v || 0), 0) - out.reduce((s, v) => s + (v || 0), 0);
    } },
    { key: 'diff', label: 'Differenz', type: 'calc', calc: (r, c) => (num(r.ende) == null || c.soll == null ? null : num(r.ende) - c.soll) },
    { key: 'diffPct', label: 'Diff. %', type: 'calc', unit: '%', calc: (r, c) => {
      const basis = [r.anfang, r.zugang, r.zukauf].map(num).reduce((s, v) => s + (v || 0), 0);
      return c.diff == null || !basis ? null : c.diff / basis * 100;
    } },
    { key: 'status', label: 'Bewertung', type: 'status', calc: (r, c, chk) => rateBilanz(c.diffPct, chk.tolBilanz) }
  ];
  return {
    key: 'bilanz', title: 'Mengenbilanz (Warenfluss)', tol: 'tolBilanz', optional: opts.optional !== false,
    hint: 'Anfangsbestand + Erzeugung + Zukauf − Verkauf − Eigenverbrauch/Verluste = Soll-Endbestand. Die Differenz zur Inventur wird gegen die Bilanz-Toleranz geprüft.',
    columns: cols,
    newRow: () => ({ einheit: opts.einheit || 'dt' })
  };
}

const TABLES = {
  pflanzenbau: [
    // Reihenfolge wie im Anbaujahr: erst das Saatgut, dann die Ernte.
    {
      key: 'saat', title: 'Saat- und Pflanzgut', tol: 'tolErtrag',
      hint: 'Eingesetzte Menge (eigenes + zugekauftes Öko-Saatgut) im Vergleich zum Bedarf aus der Saatstärke. Tausendkornmassen sind sortenabhängig — Referenz ggf. anpassen.',
      columns: [
        { key: 'kultur', label: 'Kultur', type: 'select', width: 170, options: WF_KULTUREN.map(k => ({ value: k.key, label: k.label })),
          onSelect: (row, v) => { const k = WF_KULTUREN.find(x => x.key === v); Object.assign(row, refFrom(k && k.saat)); fillFlaeche(row, v); } },
        { key: 'flaeche', label: 'Fläche', unit: 'ha', type: 'num', sum: true },
        { key: 'refTyp', label: 'Bedarf je ha', unit: 'kg/ha', type: 'ref' },
        { key: 'bedarf', label: 'Bedarf gesamt', unit: 'kg', type: 'calc', sum: true, calc: r => (num(r.flaeche) != null && num(r.refTyp) != null ? num(r.flaeche) * num(r.refTyp) : null) },
        { key: 'eingesetzt', label: 'Eingesetzt', unit: 'kg', type: 'num', sum: true },
        { key: 'jeHa', label: 'Eingesetzt je ha', unit: 'kg/ha', type: 'calc', calc: r => (num(r.eingesetzt) != null && num(r.flaeche) ? num(r.eingesetzt) / num(r.flaeche) : null) },
        { key: 'status', label: 'Bewertung', type: 'status', calc: (r, c, chk) => rateAgainstRef(c.jeHa, r, chk.tolErtrag) }
      ],
      newRow: () => ({})
    },
    {
      key: 'ertrag', title: 'Ernte und Ertrag je Hektar', tol: 'tolErtrag',
      hint: 'Angegebene Erntemenge im Vergleich zum Referenzertrag. Referenzen sind Mittelwerte — Standort und Jahr können deutlich abweichen.',
      refKey: 'kultur',
      columns: [
        { key: 'kultur', label: 'Kultur', type: 'select', width: 170, options: WF_KULTUREN.map(k => ({ value: k.key, label: k.label })),
          onSelect: (row, v) => { const k = WF_KULTUREN.find(x => x.key === v); Object.assign(row, refFrom(k && k.ertrag)); if (k && k.key !== 'sonstige') row.kulturName = k.label; fillFlaeche(row, v); } },
        { key: 'flaeche', label: 'Fläche', unit: 'ha', type: 'num', sum: true },
        { key: 'refTyp', label: 'Referenz', unit: 'dt/ha', type: 'ref' },
        { key: 'erwartet', label: 'Ernte erwartet', unit: 'dt', type: 'calc', sum: true, calc: r => (num(r.flaeche) != null && num(r.refTyp) != null ? num(r.flaeche) * num(r.refTyp) : null) },
        { key: 'ernte', label: 'Ernte angegeben', unit: 'dt', type: 'num', sum: true },
        { key: 'ertragHa', label: 'Ertrag', unit: 'dt/ha', type: 'calc', calc: r => (num(r.ernte) != null && num(r.flaeche) ? num(r.ernte) / num(r.flaeche) : null) },
        { key: 'status', label: 'Bewertung', type: 'status', calc: (r, c, chk) => rateAgainstRef(c.ertragHa, r, chk.tolErtrag) }
      ],
      newRow: () => ({})
    },
    bilanzTable({ zugangLabel: 'Ernte', sonstLabel: 'Saatgut / Verfütterung / Verluste' })
  ],
  tierhaltung: [
    {
      key: 'leistung', title: 'Tierische Leistung', tol: 'tolErtrag',
      hint: 'Erzeugte/vermarktete Menge im Vergleich zur Referenzleistung je Tier.',
      columns: [
        { key: 'tierart', label: 'Tierart', type: 'select', width: 160, options: WF_TIERE.filter(t => t.leistung || t.key === 'sonstige').map(t => ({ value: t.key, label: t.label })),
          onSelect: (row, v) => { const t = WF_TIERE.find(x => x.key === v); Object.assign(row, refFrom(t && t.leistung)); row.basis = t ? t.basis : ''; row.produktLabel = t && t.leistung ? t.leistung.label : ''; } },
        { key: 'anzahl', label: 'Anzahl', type: 'num', unitFrom: 'basis' },
        { key: 'refTyp', label: 'Referenz je Tier', type: 'ref', unitFrom: 'refEinheit' },
        { key: 'erwartet', label: 'Erwartet', type: 'calc', calc: r => (num(r.anzahl) != null && num(r.refTyp) != null ? num(r.anzahl) * num(r.refTyp) : null) },
        { key: 'angegeben', label: 'Angegeben', type: 'num' },
        { key: 'jeTier', label: 'je Tier', type: 'calc', calc: r => (num(r.angegeben) != null && num(r.anzahl) ? num(r.angegeben) / num(r.anzahl) : null) },
        { key: 'status', label: 'Bewertung', type: 'status', calc: (r, c, chk) => rateAgainstRef(c.jeTier, r, chk.tolErtrag) }
      ],
      newRow: () => ({})
    },
    {
      key: 'futter', title: 'Futterbedarf und Futtermittel', tol: 'tolErtrag',
      hint: 'Verfügbares Futter (eigene Erzeugung + Öko-Zukauf) im Vergleich zum Bedarf aus der Referenz je Tier.',
      columns: [
        { key: 'tierart', label: 'Tierart', type: 'select', width: 160, options: WF_TIERE.filter(t => t.futter || t.key === 'sonstige').map(t => ({ value: t.key, label: t.label })),
          onSelect: (row, v) => { const t = WF_TIERE.find(x => x.key === v); Object.assign(row, refFrom(t && t.futter)); row.basis = t ? t.basis : ''; row.produktLabel = t && t.futter ? t.futter.label : ''; } },
        { key: 'anzahl', label: 'Anzahl', type: 'num', unitFrom: 'basis' },
        { key: 'refTyp', label: 'Bedarf je Tier', type: 'ref', unitFrom: 'refEinheit' },
        { key: 'bedarf', label: 'Bedarf gesamt', unit: 'kg', type: 'calc', sum: true, calc: r => (num(r.anzahl) != null && num(r.refTyp) != null ? num(r.anzahl) * num(r.refTyp) : null) },
        { key: 'verfuegbar', label: 'Futter verfügbar', unit: 'kg', type: 'num', sum: true },
        { key: 'jeTier', label: 'je Tier', type: 'calc', calc: r => (num(r.verfuegbar) != null && num(r.anzahl) ? num(r.verfuegbar) / num(r.anzahl) : null) },
        { key: 'status', label: 'Bewertung', type: 'status', calc: (r, c, chk) => rateAgainstRef(c.jeTier, r, chk.tolErtrag) }
      ],
      newRow: () => ({})
    },
    bilanzTable({ zugangLabel: 'Erzeugung', sonstLabel: 'Eigenverbrauch / Verluste', einheit: 'kg' })
  ],
  imkerei: [
    {
      key: 'honig', title: 'Honigernte je Volk', tol: 'tolErtrag',
      hint: 'Geerntete Honigmenge im Vergleich zum Bundesdurchschnitt — Trachtjahr und Region bewusst berücksichtigen.',
      columns: [
        { key: 'standort', label: 'Standort / Stand', type: 'text', width: 150, placeholder: 'z. B. Stand Waldrand' },
        { key: 'voelker', label: 'Völker', type: 'num', sum: true },
        { key: 'refTyp', label: 'Referenz', unit: 'kg/Volk', type: 'ref' },
        { key: 'erwartet', label: 'Erwartet', unit: 'kg', type: 'calc', sum: true, calc: r => (num(r.voelker) != null && num(r.refTyp) != null ? num(r.voelker) * num(r.refTyp) : null) },
        { key: 'geerntet', label: 'Geerntet', unit: 'kg', type: 'num', sum: true },
        { key: 'jeVolk', label: 'je Volk', unit: 'kg', type: 'calc', calc: r => (num(r.geerntet) != null && num(r.voelker) ? num(r.geerntet) / num(r.voelker) : null) },
        { key: 'status', label: 'Bewertung', type: 'status', calc: (r, c, chk) => rateAgainstRef(c.jeVolk, r, chk.tolErtrag) }
      ],
      newRow: () => ({ ...refFrom(WF_IMKEREI.honig) })
    },
    bilanzTable({ zugangLabel: 'Ernte', sonstLabel: 'Eigenverbrauch / Verluste', einheit: 'kg' })
  ],
  verarbeitung: [
    {
      key: 'ausbeute', title: 'Ausbeute (Rohware → Produkt)', tol: 'tolErtrag',
      hint: 'Erzeugte Produktmenge im Vergleich zur erwarteten Ausbeute aus der eingesetzten Rohware.',
      columns: [
        { key: 'prozess', label: 'Prozess', type: 'select', width: 210, options: WF_PROZESSE.map(p => ({ value: p.key, label: p.label, group: p.gruppe })),
          onSelect: (row, v) => { const p = WF_PROZESSE.find(x => x.key === v); Object.assign(row, refFrom(p)); row.ein = p ? p.ein : ''; row.aus = p ? p.aus : ''; row.refEinheit = p ? `${p.aus} je ${p.ein}` : ''; } },
        { key: 'einsatz', label: 'Rohware eingesetzt', type: 'num', unitFrom: 'ein' },
        { key: 'refTyp', label: 'Ausbeute (Faktor)', type: 'ref', unitFrom: 'refEinheit', decimals: 3 },
        { key: 'erwartet', label: 'Erwartet', type: 'calc', unitFrom: 'aus', calc: r => (num(r.einsatz) != null && num(r.refTyp) != null ? num(r.einsatz) * num(r.refTyp) : null) },
        { key: 'erzeugt', label: 'Erzeugt', type: 'num', unitFrom: 'aus' },
        { key: 'faktor', label: 'Ausbeute Ist', type: 'calc', decimals: 3, calc: r => (num(r.erzeugt) != null && num(r.einsatz) ? num(r.erzeugt) / num(r.einsatz) : null) },
        { key: 'status', label: 'Bewertung', type: 'status', calc: (r, c, chk) => rateAgainstRef(c.faktor, r, chk.tolErtrag) }
      ],
      newRow: () => ({})
    },
    bilanzTable({ zugangLabel: 'Herstellung', sonstLabel: 'Einsatz in Produktion / Verluste', einheit: 'kg' })
  ],
  handel: [
    bilanzTable({ noZugang: true, sonstLabel: 'Schwund / Verderb', einheit: 'kg', optional: false })
  ],
  kette: [], // eigene Darstellung (Stufen), siehe "Warenflusskette"
  bestand: [] // Freitext aus dem Tierbestand (HIT-Auszug), siehe "Bestandsentwicklung Rinder"
};

// Mengenbilanz ist abschaltbar (chk.mitBilanz). Ältere Prüfungen ohne das
// Feld zeigen sie, wenn schon Werte darin stehen.
export function bilanzAn(chk) {
  if (typeof chk.mitBilanz === 'boolean') return chk.mitBilanz;
  if (chk.modul === 'kette') return true;
  const t = (TABLES[chk.modul] || []).find(x => x.key === 'bilanz');
  return !!t && (chk.tables[t.key] || []).some(r => rowHasInput(t, r));
}
function visibleTables(chk) {
  return (TABLES[chk.modul] || []).filter(t => !t.optional || bilanzAn(chk));
}

// ---------------- Warenflusskette ----------------
// Mehrere Stufen, die aufeinander aufbauen: z. B. Milchkühe → Milch →
// Molkerei (Schnittkäse) → Verkauf, oder Karkassen (Zukauf) → Hühnerbrühe →
// Verkauf. Jede Stufe hat
//   – eine Erzeugung (Tierleistung, Ernte oder Verarbeitungsausbeute) mit
//     Referenz und Ampel (entfällt bei "Zukauf / Ware"),
//   – einen Verbleib (Mengenbilanz): Anfangsbestand + Erzeugung + Zukauf −
//     Verkauf − Verluste − an Folgestufen = Soll-Endbestand vs. Inventur.
// Eine Verarbeitungsstufe nimmt ihre Rohware aus einer früheren Stufe
// (quelleId); deren Einsatz zählt dort als Abgang "an Folgestufen". So lassen
// sich auch Verzweigungen abbilden (Milch → Käse und Milch → Butter).
// Stufe: { id, art, produkt, einheit, quelleId, refKey, basis, erzeugt,
//          anfang, zukauf, verkauf, sonst, ende, ref*-Felder }
export const WF_STUFEN_ARTEN = {
  tier: { label: 'Erzeugung · Tierhaltung', icon: 'pets' },
  pflanze: { label: 'Erzeugung · Pflanzenbau', icon: 'grass' },
  prozess: { label: 'Verarbeitung', icon: 'handyman' },
  ware: { label: 'Zukauf / Ware', icon: 'compare_arrows' }
};
const STUFE_GRUNDLAGEN = { tier: 'tierhaltung', pflanze: 'pflanzenbau', prozess: 'verarbeitung', ware: 'handel' };
const EINHEITEN = ['kg', 'l', 'dt', 't', 'Stück'];
function newStufe(art = 'prozess', quelleId = '') {
  return { id: uid(), art, produkt: '', einheit: art === 'pflanze' ? 'dt' : 'kg', quelleId, refKey: '', ...refFrom(null) };
}
function stufeRefOptions(art) {
  if (art === 'tier') return WF_TIERE.filter(t => t.leistung || t.key === 'sonstige').map(t => ({ value: t.key, label: t.label }));
  if (art === 'pflanze') return WF_KULTUREN.map(k => ({ value: k.key, label: k.label }));
  if (art === 'prozess') return WF_PROZESSE.map(p => ({ value: p.key, label: p.label, group: p.gruppe }));
  return [];
}
// Referenz übernehmen; Produktname/Einheit nur vorbelegen, solange sie nicht
// von Hand geändert wurden.
function applyStufeRef(s, key) {
  s.refKey = key;
  let produkt = '', einheit = s.einheit;
  if (s.art === 'tier') {
    const t = WF_TIERE.find(x => x.key === key);
    Object.assign(s, refFrom(t && t.leistung));
    s.basisLabel = t ? t.basis : '';
    if (t && t.leistung) {
      produkt = t.leistung.label.replace(/^\w/, ch => ch.toUpperCase());
      einheit = (/^(kg|l|dt|t)\b/.exec(t.leistung.einheit) || [])[1] || 'Stück';
    }
  } else if (s.art === 'pflanze') {
    const k = WF_KULTUREN.find(x => x.key === key);
    Object.assign(s, refFrom(k && k.ertrag));
    fillFlaeche(s, key, 'basis');
    s.refEinheit = 'dt/ha';
    if (k && k.key !== 'sonstige') { produkt = k.label; einheit = 'dt'; }
  } else if (s.art === 'prozess') {
    const p = WF_PROZESSE.find(x => x.key === key);
    Object.assign(s, refFrom(p));
    s.ein = p ? p.ein : ''; s.aus = p ? p.aus : '';
    s.refEinheit = p ? `${p.aus} je ${p.ein}` : '';
    if (p && p.key !== 'sonstige') {
      produkt = (p.label.split('→')[1] || '').replace(/\(.*\)/, '').trim();
      einheit = (/^(kg|l|dt|t)\b/.exec(p.aus) || [])[1] || einheit;
    }
  }
  if (produkt && (!s.produkt || s.produkt === s.produktAuto)) { s.produkt = produkt; s.produktAuto = produkt; }
  if (einheit) s.einheit = einheit;
}
const stufeNr = (chk, id) => chk.stufen.findIndex(x => x.id === id) + 1;
const stufeName = (chk, s) => `Stufe ${stufeNr(chk, s.id)}${s.produkt ? ` (${s.produkt})` : ''}`;
export function computeStufe(chk, s) {
  const c = {};
  const b = num(s.basis), e = num(s.erzeugt), ref = num(s.refTyp);
  if (s.art !== 'ware') {
    c.erwartet = b != null && ref != null ? b * ref : null;
    c.kennzahl = e != null && b ? e / b : null;
    c.status = rateAgainstRef(c.kennzahl, s, s.art === 'prozess' ? (chk.tolAusbeute ?? 5) : chk.tolErtrag);
  }
  c.abnehmer = chk.stufen.filter(x => x.quelleId === s.id);
  c.weiter = c.abnehmer.length ? c.abnehmer.reduce((sum, x) => sum + (num(x.basis) || 0), 0) : null;
  const zug = s.art === 'ware' ? null : e;
  const ins = [num(s.anfang), zug, num(s.zukauf)], outs = [num(s.verkauf), num(s.sonst), c.weiter];
  const any = [num(s.anfang), num(s.zukauf), num(s.verkauf), num(s.sonst), num(s.ende)].some(v => v != null);
  c.soll = any ? ins.reduce((x, v) => x + (v || 0), 0) - outs.reduce((x, v) => x + (v || 0), 0) : null;
  c.diff = num(s.ende) == null || c.soll == null ? null : num(s.ende) - c.soll;
  const basis = ins.reduce((x, v) => x + (v || 0), 0);
  c.diffPct = c.diff == null || !basis ? null : c.diff / basis * 100;
  c.bilanz = verbleibAn(chk, s) ? rateBilanz(c.diffPct, chk.tolBilanz) : null;
  return c;
}
const verbleibAn = (chk, s) => bilanzAn(chk) || s.art === 'ware';
function stufeProdCols(chk, s) {
  if (s.art === 'ware') return [];
  const src = s.quelleId && chk.stufen.find(x => x.id === s.quelleId);
  const basis = s.art === 'tier' ? { label: 'Tiere', unit: s.basisLabel || 'Anzahl' }
    : s.art === 'pflanze' ? { label: 'Fläche', unit: 'ha' }
      : { label: src ? `Rohware eingesetzt (aus Stufe ${stufeNr(chk, src.id)})` : 'Rohware eingesetzt (Zukauf)', unit: s.ein || (src ? src.einheit : '') };
  const kenn = s.art === 'tier' ? { label: 'je Tier', unit: s.einheit, d: 1 }
    : s.art === 'pflanze' ? { label: 'Ertrag', unit: 'dt/ha', d: 1 } : { label: 'Ausbeute Ist', unit: '', d: 3 };
  return [
    { key: 'refKey', label: s.art === 'tier' ? 'Tierart' : s.art === 'pflanze' ? 'Kultur' : 'Prozess', type: 'select', options: stufeRefOptions(s.art), wide: true },
    { key: 'basis', label: basis.label, type: 'num', unit: basis.unit },
    { key: 'refTyp', label: s.art === 'prozess' ? 'Ausbeute (Referenz)' : 'Referenz', type: 'ref', unitFrom: 'refEinheit', decimals: s.art === 'prozess' ? 3 : undefined },
    { key: 'erwartet', label: 'Erwartet', type: 'calc', unit: s.einheit, decimals: 0 },
    { key: 'erzeugt', label: s.art === 'pflanze' ? 'Ernte angegeben' : 'Erzeugt (angegeben)', type: 'num', unit: s.einheit },
    { key: 'kennzahl', label: kenn.label, type: 'calc', unit: kenn.unit, decimals: kenn.d },
    { key: 'status', label: 'Bewertung', type: 'status' }
  ];
}
function stufeBilanzCols(chk, s) {
  const u = s.einheit;
  return [
    { key: 'anfang', label: 'Anfangsbestand', type: 'num', unit: u },
    { key: 'zukauf', label: s.art === 'ware' ? 'Zukauf (Bio-Belege)' : 'Zukauf Produkt', type: 'num', unit: u },
    { key: 'verkauf', label: 'Verkauf / Abgabe', type: 'num', unit: u },
    { key: 'sonst', label: 'Eigenverbrauch / Verluste', type: 'num', unit: u },
    { key: 'weiter', label: 'An Folgestufe(n)', type: 'calc', unit: u, decimals: 1 },
    { key: 'ende', label: 'Endbestand (Inventur)', type: 'num', unit: u },
    { key: 'soll', label: 'Soll-Endbestand', type: 'calc', unit: u, decimals: 1 },
    { key: 'diff', label: 'Differenz', type: 'calc', unit: u, decimals: 1 },
    { key: 'diffPct', label: 'Diff. %', type: 'calc', unit: '%', decimals: 1 },
    { key: 'bilanz', label: 'Bewertung', type: 'status' }
  ];
}
// Handel: mehr Spielraum? Nein — Toleranz ist in jeder Prüfung einstellbar.

export function createWarenfluss(modul) {
  const tables = {};
  (TABLES[modul] || []).forEach(t => { tables[t.key] = [{ id: uid(), ...t.newRow() }]; });
  let stufen;
  if (modul === 'kette') {
    const erste = newStufe('tier');
    stufen = [erste, newStufe('prozess', erste.id)];
  }
  return {
    id: uid(), modul, titel: WF_MODULE[modul].label, zeitraum: String(new Date().getFullYear() - 1),
    // Verarbeitungsausbeuten sind eng (z. B. Röstverlust 11–20 %) — dort 5 % um
    // die belegte Spanne; Erträge/Leistungen schwanken nach Jahr und Standort stärker.
    modus: modul === 'bestand' ? 'text' : 'tabelle', tolErtrag: modul === 'verarbeitung' ? 5 : 25, tolBilanz: 2, tables, freitext: null,
    // Mengenbilanz nur auf Wunsch; in der Kette trägt sie die Verknüpfung (Verbleib je Stufe).
    mitBilanz: modul === 'handel' || modul === 'kette',
    ...(modul === 'kette' ? { stufen, tolAusbeute: 5 } : {}),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

// Alle berechneten Werte einer Zeile (in Spaltenreihenfolge, damit spätere
// Spalten auf frühere zugreifen können).
function computeRow(table, row, chk) {
  const c = {};
  table.columns.forEach(col => {
    if (col.type === 'calc' || col.type === 'status') {
      try { c[col.key] = col.calc(row, c, chk); } catch { c[col.key] = null; }
    }
  });
  return c;
}
const rowHasInput = (table, row) => table.columns.some(col => (col.type === 'num' || col.type === 'text') && row[col.key] != null && row[col.key] !== '');

export function summarizeWarenfluss(chk) {
  const out = { ok: 0, warn: 0, bad: 0 };
  if (chk.modul === 'bestand') {
    if (chk.bestand) out[chk.bestand.bilanzOk ? 'ok' : 'bad'] = 1;
    return out;
  }
  if (chk.modul === 'kette') {
    (chk.stufen || []).forEach(s => {
      const c = computeStufe(chk, s);
      [c.status, c.bilanz].forEach(x => { if (x && out[x.level] != null) out[x.level]++; });
    });
    return out;
  }
  visibleTables(chk).forEach(t => (chk.tables[t.key] || []).forEach(r => {
    const s = computeRow(t, r, chk).status;
    if (s && out[s.level] != null) out[s.level]++;
  }));
  return out;
}

// ---- Freitext (automatisch aus der Berechnung) ----
// Aus den Tabellenwerten entsteht ein ausformulierter Prüfbericht: je
// Tabelle eine Zusammenfassung, die Einzelwerte, zu jeder Abweichung ein
// Befund mit Richtung und möglichen Ursachen, daraus die Klärungspunkte und
// das Gesamtergebnis. Fehlende Angaben bleiben als […] bzw. [ ] stehen.
const L = (v, d = 1, unit = '') => (v == null ? '[…]' : fmt(v, d) + (unit ? ' ' + unit : ''));
const optLabel = (table, key, value) => {
  const col = table.columns.find(c => c.key === key);
  const o = col && col.options && col.options.find(x => x.value === value);
  return o ? o.label : (value || '[…]');
};
const quelleKurz = (row) => (row.refQuelle && WF_QUELLEN[row.refQuelle] ? WF_QUELLEN[row.refQuelle].kurz : 'eigene Angabe');
const devText = (s) => (s && s.dev != null ? `${s.dev >= 0 ? '+' : '−'}${fmt(Math.abs(s.dev), 0)} %` : '');
// Ohne Vorzeichen für Sätze wie "liegt 79 % über …".
const devAbs = (s) => (s && s.dev != null ? `${fmt(Math.abs(s.dev), 0)} %` : '');
const plural = (n, one, many) => `${fmt(n, 0)} ${n === 1 ? one : many}`;

// Name der Zeile für Fließtext.
function rowName(t, r) {
  if (r._name) return r._name;
  if (t.key === 'ertrag' || t.key === 'saat') return r.kultur === 'sonstige' || !r.kultur ? (r.kulturName || 'Kultur […]') : optLabel(t, 'kultur', r.kultur);
  if (t.key === 'leistung' || t.key === 'futter') return optLabel(t, 'tierart', r.tierart);
  if (t.key === 'honig') return r.standort || 'Bienenstand';
  if (t.key === 'ausbeute') return optLabel(t, 'prozess', r.prozess);
  if (t.key === 'bilanz') return r.produkt || 'Produkt […]';
  return '';
}

// Befund + Klärungspunkt für eine nicht plausible Zeile.
function befund(t, r, c) {
  const s = c.status;
  if (!s || s.level === 'ok') return null;
  const hoch = s.dev != null ? s.dev > 0 : (c.diff != null ? c.diff > 0 : false);
  const name = rowName(t, r);
  const art = s.level === 'bad' ? 'auffällig' : 'zu prüfen';
  const devText = devAbs; // in Befundsätzen ohne Vorzeichen
  switch (t.key) {
    case 'ertrag': return hoch
      ? { text: `${name}: Der Ertrag von ${L(c.ertragHa, 1, 'dt/ha')} liegt ${devText(s)} über dem Referenzwert (${L(num(r.refTyp), 1, 'dt/ha')}, ${quelleKurz(r)}) — ${art}. Mögliche Ursachen: nicht deklarierter Zukauf, zu niedrige Flächenangabe, Vermischung von Partien.`,
          klaerung: `${name}: Erläuterung des hohen Ertrags (${L(c.ertragHa, 1, 'dt/ha')}) mit Ernte-/Wiegebelegen und Flächennachweis.` }
      : { text: `${name}: Der Ertrag von ${L(c.ertragHa, 1, 'dt/ha')} liegt ${devText(s)} unter dem Referenzwert (${L(num(r.refTyp), 1, 'dt/ha')}, ${quelleKurz(r)}) — ${art}. Plausibel bei Witterungs- oder Schadereignissen; zu prüfen sind nicht erfasste Verkäufe oder Abgänge.`,
          klaerung: `${name}: Begründung des niedrigen Ertrags (${L(c.ertragHa, 1, 'dt/ha')}) und Nachweis des Verbleibs der Ernte.` };
    case 'saat': return hoch
      ? { text: `${name}: Mit ${L(c.jeHa, 0, 'kg/ha')} wurde ${devText(s)} mehr Saatgut eingesetzt als nach Saatstärke erforderlich (${L(num(r.refTyp), 0, 'kg/ha')}) — ${art}. Verbleib bzw. Verwendung der Mehrmenge klären.`,
          klaerung: `${name}: Verwendung der Saatgut-Mehrmenge und Öko-Herkunft des Saatguts belegen.` }
      : { text: `${name}: Mit ${L(c.jeHa, 0, 'kg/ha')} wurde ${devText(s)} weniger Saatgut belegt als nach Saatstärke erforderlich (${L(num(r.refTyp), 0, 'kg/ha')}) — ${art}. Nicht belegter (ggf. konventioneller) Saatgutzukauf ist auszuschließen.`,
          klaerung: `${name}: Vollständige Saatgutbelege (Öko-Saatgut bzw. Ausnahmegenehmigung) vorlegen.` };
    case 'leistung': return hoch
      ? { text: `${name}: Die angegebene Leistung von ${L(c.jeTier, 1)} ${r.refEinheit || ''} liegt ${devText(s)} über der Referenz (${L(num(r.refTyp), 1)}, ${quelleKurz(r)}) — ${art}. Zukauf von Tieren oder Produkten bzw. Vermischung mit nicht ökologischer Ware ausschließen.`,
          klaerung: `${name}: Erläuterung der hohen Leistung; Bestandsregister und Abrechnungen vorlegen.` }
      : { text: `${name}: Die angegebene Leistung von ${L(c.jeTier, 1)} ${r.refEinheit || ''} liegt ${devText(s)} unter der Referenz (${L(num(r.refTyp), 1)}, ${quelleKurz(r)}) — ${art}. Verbleib klären (Direktvermarktung, Eigenverbrauch, Verluste).`,
          klaerung: `${name}: Verbleib der Differenz zur Referenzleistung belegen.` };
    case 'futter': return hoch
      ? { text: `${name}: Das belegte Futter übersteigt den Bedarf um ${devText(s)} — ${art}. Verbleib des Überschusses klären (Verkauf, Lagerbestand).`,
          klaerung: `${name}: Verbleib des Futterüberschusses belegen.` }
      : { text: `${name}: Der Futterbedarf (${L(c.bedarf, 0, 'kg')}) ist durch das belegte Futter (${L(num(r.verfuegbar), 0, 'kg')}) nur zu ${fmt(100 + (s.dev || 0), 0)} % gedeckt — ${art}. Ein nicht belegter, ggf. konventioneller Futterzukauf ist auszuschließen.`,
          klaerung: `${name}: Vollständige Futterbilanz mit allen Futtermittelbelegen (Öko-Nachweis) vorlegen.` };
    case 'honig': return hoch
      ? { text: `${name}: ${L(c.jeVolk, 1, 'kg')} Honig je Volk liegen ${devText(s)} über dem Durchschnitt (${L(num(r.refTyp), 1, 'kg')}) — ${art}. Honigzukauf ausschließen; Trachtsituation und Wanderung berücksichtigen.`,
          klaerung: `${name}: Erläuterung der hohen Honigernte (Trachten, Wanderung) und Belege über Honigzukäufe.` }
      : { text: `${name}: ${L(c.jeVolk, 1, 'kg')} Honig je Volk liegen ${devText(s)} unter dem Durchschnitt (${L(num(r.refTyp), 1, 'kg')}) — ${art}. Verbleib klären bzw. schwaches Trachtjahr dokumentieren.`,
          klaerung: `${name}: Begründung der geringen Honigernte.` };
    case 'ausbeute': return hoch
      ? { text: `${name}: Mit einer Ausbeute von ${L(c.faktor, 3)} wurde ${devText(s)} mehr Produkt erzeugt als aus der eingesetzten Rohware zu erwarten (${L(num(r.refTyp), 3)}, ${quelleKurz(r)}) — ${art}. Nicht belegter (ggf. nicht ökologischer) Rohwarenzukauf ist auszuschließen.`,
          klaerung: `${name}: Rezeptur und Produktionsprotokolle sowie vollständige Wareneingangsbelege der Rohware vorlegen.` }
      : { text: `${name}: Mit einer Ausbeute von ${L(c.faktor, 3)} wurde ${devText(s)} weniger Produkt erzeugt als zu erwarten (${L(num(r.refTyp), 3)}, ${quelleKurz(r)}) — ${art}. Verbleib der Rohware bzw. des Produkts klären (Ausschuss, nicht erfasster Verkauf).`,
          klaerung: `${name}: Verbleib der Rohware (Ausschuss, Lager, Verkauf) belegen.` };
    case 'bilanz': {
      const e = r.einheit || '';
      return (c.diff || 0) > 0
        ? { text: `${name}: Der Inventurbestand liegt um ${L(c.diff, 1, e)} (${fmt(c.diffPct, 1)} %) über dem rechnerischen Bestand — ${art}. Herkunft der Mehrmenge ist zu belegen (Zukauf ohne Beleg?).`,
            klaerung: `${name}: Herkunft der Mehrmenge von ${L(c.diff, 1, e)} mit Belegen nachweisen.` }
        : { text: `${name}: Gegenüber dem rechnerischen Bestand fehlen ${L(Math.abs(c.diff), 1, e)} (${fmt(c.diffPct, 1)} %) — ${art}. Verbleib klären (nicht erfasster Verkauf, Schwund, Verderb).`,
            klaerung: `${name}: Verbleib der fehlenden ${L(Math.abs(c.diff), 1, e)} belegen.` };
    }
    default: return null;
  }
}

// Detailzeile je Tabelle.
function detailLine(t, r, c) {
  const status = c.status ? LEVEL_TEXT[c.status.level] : '[Bewertung]';
  const dev = c.status && c.status.dev != null && t.key !== 'bilanz' ? ` (${devText(c.status)} zur Referenz)` : '';
  const name = rowName(t, r);
  switch (t.key) {
    case 'ertrag': return `– ${name}: ${L(num(r.flaeche), 4, 'ha')}${r.flaecheAuto ? ' (lt. Flächenübersicht)' : ''}, Ernte ${L(num(r.ernte), 1, 'dt')} = ${L(c.ertragHa, 1, 'dt/ha')}; Referenz ${L(num(r.refTyp), 1, 'dt/ha')} (${quelleKurz(r)}) → ${status}${dev}.`;
    case 'saat': return `– ${name}: ${L(num(r.flaeche), 4, 'ha')}${r.flaecheAuto ? ' (lt. Flächenübersicht)' : ''}, eingesetzt ${L(num(r.eingesetzt), 0, 'kg')} = ${L(c.jeHa, 0, 'kg/ha')}; Bedarf ${L(num(r.refTyp), 0, 'kg/ha')} (${quelleKurz(r)}) → ${status}${dev}. Herkunft (Öko / Ausnahmegenehmigung): [ ].`;
    case 'leistung': return `– ${name}: ${L(num(r.anzahl), 0)} (${r.basis || 'Anzahl'}), ${r.produktLabel || 'Leistung'} ${L(num(r.angegeben), 0)} = ${L(c.jeTier, 1)} ${r.refEinheit || ''}; Referenz ${L(num(r.refTyp), 1)} (${quelleKurz(r)}) → ${status}${dev}.`;
    case 'futter': return `– ${name}: Bedarf ${L(c.bedarf, 0, 'kg')} (${L(num(r.refTyp), 1)} ${r.refEinheit || ''}, ${quelleKurz(r)}), belegt ${L(num(r.verfuegbar), 0, 'kg')} → ${status}${dev}. Zukauf ausschließlich Öko-Futter: [ja / nein].`;
    case 'honig': return `– ${name}: ${L(num(r.voelker), 0, 'Völker')}, geerntet ${L(num(r.geerntet), 0, 'kg')} = ${L(c.jeVolk, 1, 'kg/Volk')}; Referenz ${L(num(r.refTyp), 1, 'kg/Volk')} (${quelleKurz(r)}) → ${status}${dev}.`;
    case 'ausbeute': return `– ${name}: Einsatz ${L(num(r.einsatz), 0, r.ein || '')}, erzeugt ${L(num(r.erzeugt), 0, r.aus || '')} (Ausbeute ${L(c.faktor, 3)}); erwartet ${L(c.erwartet, 0, r.aus || '')} bei Faktor ${L(num(r.refTyp), 3)} (${quelleKurz(r)}) → ${status}${dev}.`;
    case 'bilanz': {
      const e = r.einheit || '';
      const zug = t.columns.some(cc => cc.key === 'zugang') ? `, Erzeugung ${L(num(r.zugang), 1, e)}` : '';
      return `– ${name}: Anfangsbestand ${L(num(r.anfang), 1, e)}${zug}, Zukauf ${L(num(r.zukauf), 1, e)}, Verkauf ${L(num(r.verkauf), 1, e)}, Eigenverbrauch/Verluste ${L(num(r.sonst), 1, e)} → Soll ${L(c.soll, 1, e)}, Inventur ${L(num(r.ende), 1, e)}, Differenz ${L(c.diff, 1, e)}${c.diffPct != null ? ` (${fmt(c.diffPct, 1)} %)` : ''} → ${status}.`;
    }
    default: return '';
  }
}

// Zusammenfassender Satz je Tabelle.
function summaryLine(t, rows) {
  const levels = { ok: 0, warn: 0, bad: 0 };
  const sum = (key, calc) => rows.reduce((s, x) => {
    const v = calc ? x.c[key] : num(x.r[key]);
    return v == null ? s : s + v;
  }, 0);
  rows.forEach(x => { if (x.c.status) levels[x.c.status.level]++; });
  const bew = [levels.ok && `${levels.ok} plausibel`, levels.warn && `${levels.warn} zu prüfen`, levels.bad && `${levels.bad} auffällig`].filter(Boolean).join(', ') || 'noch ohne Bewertung';
  const n = rows.length;
  switch (t.key) {
    case 'ertrag': return `Geprüft wurden ${plural(n, 'Kultur', 'Kulturen')} auf zusammen ${L(sum('flaeche'), 2, 'ha')} mit einer angegebenen Gesamternte von ${L(sum('ernte'), 1, 'dt')} (nach Referenz erwartet: ${L(sum('erwartet', true), 1, 'dt')}). Bewertung: ${bew}.`;
    case 'saat': return `Für ${plural(n, 'Kultur', 'Kulturen')} wurde das eingesetzte Saat-/Pflanzgut (${L(sum('eingesetzt'), 0, 'kg')}) dem Bedarf nach Saatstärke (${L(sum('bedarf', true), 0, 'kg')}) gegenübergestellt. Bewertung: ${bew}.`;
    case 'leistung': return `Für ${plural(n, 'Tierart', 'Tierarten')} wurde die angegebene Leistung mit Referenzleistungen verglichen. Bewertung: ${bew}.`;
    case 'futter': {
      const bedarf = sum('bedarf', true), verf = sum('verfuegbar');
      return `Futterbedarf insgesamt ${L(bedarf, 0, 'kg')}, belegt verfügbar ${L(verf, 0, 'kg')}${bedarf ? ` (Deckung ${fmt(verf / bedarf * 100, 0)} %)` : ''}. Bewertung: ${bew}.`;
    }
    case 'honig': {
      const v = sum('voelker'), g = sum('geerntet');
      return `${L(v, 0, 'Völker')} an ${plural(n, 'Stand', 'Ständen')}, geerntet ${L(g, 0, 'kg')} Honig${v ? ` (Ø ${fmt(g / v, 1)} kg je Volk)` : ''}. Bewertung: ${bew}.`;
    }
    case 'ausbeute': return `Geprüft wurden ${plural(n, 'Verarbeitungsprozess', 'Verarbeitungsprozesse')} (Ausbeute Rohware → Produkt). Bewertung: ${bew}.`;
    case 'bilanz': return `Für ${plural(n, 'Produkt', 'Produkte')} wurde die Mengenbilanz gerechnet (Anfangsbestand + Erzeugung + Zukauf − Abgänge = Soll-Endbestand, verglichen mit der Inventur). Bewertung: ${bew}.`;
    default: return '';
  }
}

const GRUNDLAGEN = {
  pflanzenbau: 'Flächennachweis/Anbauplan, Ernte- und Lageraufzeichnungen, Saatgutbelege (inkl. Öko-Saatgut-Nachweise bzw. Ausnahmegenehmigungen), Verkaufs- und Lieferbelege, Inventur.',
  tierhaltung: 'Bestandsregister, Zu- und Abgangsbelege der Tiere, Futtermittelbelege und -aufzeichnungen, Milchgeld-/Eierabrechnungen, Schlachtbelege, Inventur.',
  imkerei: 'Völkerverzeichnis und Standortplan, Ernteaufzeichnungen, Belege über Wachs und Futter (Öko-Zucker/-Honig), Verkaufsbelege, Lagerbestand.',
  verarbeitung: 'Rezepturen, Produktionsprotokolle, Wareneingangsbelege (Öko-Zertifikate der Lieferanten), Warenausgangsbelege, Inventur von Rohware und Fertigprodukten.',
  handel: 'Zukaufsbelege mit Öko-Kennzeichnung und Zertifikaten der Lieferanten, Verkaufsbelege, Lagerbuchhaltung, Inventur.'
};

export function generateWarenflussText(chk, ctx) {
  if (chk.modul === 'kette') return generateKetteText(chk, ctx);
  if (chk.modul === 'bestand') return generateBestandText(chk, ctx);
  const tbls = visibleTables(chk);
  const lines = [];
  const klaerung = { bad: [], warn: [] };
  const quellen = new Set();
  lines.push(`Warenflussprüfung ${WF_MODULE[chk.modul].label} — ${ctx.betrieb || '[Betrieb]'}`);
  lines.push(`Zeitraum: ${chk.zeitraum || '[Wirtschaftsjahr]'} · Kontrolle am ${ctx.datum || '[Datum]'}${ctx.kontrolleur ? ' · ' + ctx.kontrolleur : ''}`);
  lines.push('');
  lines.push('Grundlagen der Prüfung: ' + GRUNDLAGEN[chk.modul]);
  lines.push('');

  tbls.forEach(t => {
    const rows = (chk.tables[t.key] || []).filter(r => rowHasInput(t, r)).map(r => ({ r, c: computeRow(t, r, chk) }));
    lines.push(t.title);
    if (!rows.length) { lines.push('[nicht geprüft / keine Angaben]'); lines.push(''); return; }
    lines.push(summaryLine(t, rows));
    rows.forEach(({ r, c }) => {
      lines.push(detailLine(t, r, c));
      if (r.refQuelle && WF_QUELLEN[r.refQuelle] && r.refQuelle !== 'annahme') quellen.add(WF_QUELLEN[r.refQuelle].titel);
    });
    const befunde = rows.map(({ r, c }) => ({ b: befund(t, r, c), level: c.status && c.status.level })).filter(x => x.b);
    if (befunde.length) {
      lines.push('Befund:');
      befunde.forEach(({ b, level }) => { lines.push('• ' + b.text); klaerung[level].push(b.klaerung); });
    }
    lines.push('');
  });

  const sum = summarizeWarenfluss(chk);
  const tolText = `Referenzwerte ± ${fmt(chk.tolErtrag, 0)} %${tbls.some(t => t.key === 'bilanz') ? `, Mengenbilanz ± ${fmt(chk.tolBilanz, 1)} %` : ''}`;
  pushErgebnis(lines, sum, tolText, klaerung, quellen);
  return lines.join('\n');
}

// Ergebnis, Klärungspunkte und Quellen — gemeinsam für Tabellen und Kette.
function pushErgebnis(lines, sum, tolText, klaerung, quellen) {
  lines.push('Ergebnis');
  if (sum.bad) {
    lines.push(`Der Warenfluss ist auf Grundlage der vorgelegten Unterlagen nicht plausibel: ${plural(sum.bad, 'Wert liegt', 'Werte liegen')} deutlich außerhalb der Toleranz (${tolText})${sum.warn ? `, ${plural(sum.warn, 'weiterer ist', 'weitere sind')} zu prüfen` : ''}. Der Betrieb wird gebeten, folgende Punkte zu erläutern bzw. zu belegen:`);
  } else if (sum.warn) {
    lines.push(`Der Warenfluss ist im Wesentlichen plausibel. ${plural(sum.warn, 'Wert liegt', 'Werte liegen')} knapp außerhalb der Toleranz (${tolText}) und ${sum.warn === 1 ? 'ist' : 'sind'} zu prüfen:`);
  } else if (sum.ok) {
    lines.push(`Der Warenfluss ist plausibel. Alle ${plural(sum.ok, 'geprüfte Wert liegt', 'geprüften Werte liegen')} innerhalb der Toleranzen (${tolText}). Es ergeben sich keine Beanstandungen.`);
  } else {
    lines.push('[Ergebnis — noch keine bewertbaren Angaben in der Tabelle]');
  }
  [...klaerung.bad, ...klaerung.warn].forEach((k, i) => lines.push(`${i + 1}. ${k}`));
  lines.push('');
  lines.push('Erläuterung des Betriebs: [ ]');
  if (quellen.size) {
    lines.push('');
    lines.push('Referenzwerte (Orientierungswerte, betriebsindividuell angepasst wo vermerkt):');
    [...quellen].forEach(q => lines.push('– ' + q));
  }
}

// ---- Bestandsentwicklung Rinder ----
// Freitext aus dem Tierbestand (HIT-Auszug, Abschnitt "Tierbestand" in
// main.js): Bestand zur letzten Jahreskontrolle (Beginn des Auszugs),
// Zugänge (Geburten/Zukäufe), Abgänge (Verkauf, Verendung, Schlachtung …),
// Bestand zum Kontrollzeitpunkt. chk.bestand ist die Auswertung zum Zeitpunkt
// der Prüfung: { von, bis, anfang, endbestand, zugaenge: { n, arten },
// abgaenge: { n, arten, verluste }, verlustrate, klassen, gvSchnitt, bilanzOk }.
const BESTAND_ZUGANG_TEXT = { GE: ['Geburt im Betrieb', 'Geburten im Betrieb'], ZU: ['Zukauf/Zugang von einem anderen Betrieb', 'Zukäufe/Zugänge von anderen Betrieben'], ER: ['Ersterfassung', 'Ersterfassungen'], EU: ['EU-Einfuhr', 'EU-Einfuhren'], IM: ['Importmarkierung', 'Importmarkierungen'] };
const BESTAND_ABGANG_TEXT = { AB: ['Abgang an einen anderen Betrieb (Verkauf/Abgabe)', 'Abgänge an andere Betriebe (Verkauf/Abgabe)'], SC: ['Schlachtung', 'Schlachtungen'], HS: ['Hausschlachtung', 'Hausschlachtungen'], VE: ['Verendung', 'Verendungen'], TO: ['Tod', 'Todesfälle'], AU: ['Ausfuhr', 'Ausfuhren'] };
const deDatum = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('.') : '[Datum]');
function artenText(arten, texte) {
  if (!arten.length) return '';
  const teile = arten.map(a => `${a.n} ${(texte[a.art] || [a.label, a.label])[a.n === 1 ? 0 : 1]}`);
  return ', davon ' + (teile.length > 1 ? teile.slice(0, -1).join(', ') + ' und ' + teile[teile.length - 1] : teile[0]);
}
function generateBestandText(chk, ctx) {
  const b = chk.bestand;
  const lines = [];
  lines.push(`Warenflussprüfung Bestandsentwicklung Rinder — ${ctx.betrieb || '[Betrieb]'}`);
  if (!b) {
    lines.push(`Kontrolle am ${ctx.datum || '[Datum]'}${ctx.kontrolleur ? ' · ' + ctx.kontrolleur : ''}`);
    lines.push('');
    lines.push('[Für diesen Betrieb ist noch kein Tierbestand geladen. Unter „Tierbestand“ das Bestandsregister aus HI-Tier laden und diesen Betrieb wählen — der Text wird dann automatisch geschrieben.]');
    return lines.join('\n');
  }
  const tiere = (n) => `${fmt(n, 0)} ${n === 1 ? 'Rind' : 'Rinder'}`;
  lines.push(`Zeitraum: ${deDatum(b.von)} – ${deDatum(b.bis)} (seit der letzten Jahreskontrolle) · Kontrolle am ${ctx.datum || '[Datum]'}${ctx.kontrolleur ? ' · ' + ctx.kontrolleur : ''}`);
  lines.push('');
  lines.push(`Grundlage der Prüfung: Bestandsregister aus der HI-Tier-Datenbank (HIT) für den Zeitraum ${deDatum(b.von)} bis ${deDatum(b.bis)}, Abgleich mit dem Tierbestand vor Ort.`);
  lines.push('');
  lines.push(`Bestand zur letzten Jahreskontrolle (${deDatum(b.von)}): ${tiere(b.anfang)}.`);
  lines.push('');
  lines.push('Bestandsentwicklung im Zeitraum');
  lines.push(b.zugaenge.n ? `– Zugänge: ${fmt(b.zugaenge.n, 0)} ${b.zugaenge.n === 1 ? 'Tier' : 'Tiere'}${artenText(b.zugaenge.arten, BESTAND_ZUGANG_TEXT)}.` : '– Zugänge: keine.');
  lines.push(b.abgaenge.n ? `– Abgänge: ${fmt(b.abgaenge.n, 0)} ${b.abgaenge.n === 1 ? 'Tier' : 'Tiere'}${artenText(b.abgaenge.arten, BESTAND_ABGANG_TEXT)}.` : '– Abgänge: keine.');
  if (b.abgaenge.verluste) lines.push(`– Verluste (verendet/tot): ${fmt(b.abgaenge.verluste, 0)} ${b.abgaenge.verluste === 1 ? 'Tier' : 'Tiere'}${b.verlustrate != null ? ` = ${fmt(b.verlustrate, 1)} % des Durchschnittsbestands` : ''}.`);
  lines.push('');
  const klassen = (b.klassen || []).filter(k => k.anzahl).map(k => `${k.anzahl} ${k.label}`);
  lines.push(`Bestand zum Kontrollzeitpunkt (${deDatum(b.bis)}): ${tiere(b.endbestand)}${klassen.length ? ' — ' + klassen.join(', ') : ''}.`);
  if (b.gvSchnitt != null) lines.push(`Durchschnittsbestand im Zeitraum: ${fmt(b.gvSchnitt, 1)} GV.`);
  lines.push('');
  lines.push('Ergebnis');
  lines.push(b.bilanzOk
    ? `Rechnerisch: ${fmt(b.anfang, 0)} + ${fmt(b.zugaenge.n, 0)} − ${fmt(b.abgaenge.n, 0)} = ${fmt(b.endbestand, 0)} Tiere. Das entspricht dem Bestand laut HIT zum ${deDatum(b.bis)}; die Bestandsentwicklung ist nachvollziehbar.`
    : `Rechnerisch: ${fmt(b.anfang, 0)} + ${fmt(b.zugaenge.n, 0)} − ${fmt(b.abgaenge.n, 0)} = ${fmt(b.anfang + b.zugaenge.n - b.abgaenge.n, 0)} Tiere; laut HIT sind es zum ${deDatum(b.bis)} ${fmt(b.endbestand, 0)} Tiere. Die Abweichung ist zu klären.`);
  lines.push('Bestand vor Ort am Kontrolltag gezählt: [ ] Tiere — Abweichung zum Bestand laut HIT: [keine].');
  if (b.zugaenge.arten.some(a => a.art !== 'GE')) lines.push('Öko-Status bzw. Umstellungszeit der zugekauften Tiere belegt: [ja / nein].');
  lines.push('');
  lines.push('Erläuterung des Betriebs: [ ]');
  return lines.join('\n');
}
// Kurzübersicht im Tabellen-Modus (nur Anzeige — die Zahlen kommen aus dem Tierbestand).
function renderBestand() {
  const b = state.chk.bestand;
  if (!b) {
    el('wf-tables').innerHTML = `<section class="wf-section"><p class="wf-hint wf-fl-hint"><span class="material-symbols-rounded icon" aria-hidden="true">info</span>${esc(state.ctx.bestandHinweis || 'Für diesen Betrieb ist noch kein Tierbestand geladen.')}</p></section>`;
    return;
  }
  const row = (label, n, cls = '') => `<tr class="${cls}"><td>${esc(label)}</td><td class="wf-col-calc"><output class="wf-calc">${fmt(n, 0)}</output></td></tr>`;
  el('wf-tables').innerHTML = `<section class="wf-section wf-bestand">
    <div class="wf-section-head"><h4>Bestandsentwicklung ${deDatum(b.von)} – ${deDatum(b.bis)}</h4></div>
    <p class="wf-hint">Aus dem Tierbestand (HIT-Auszug) dieses Betriebs. Ändert sich der Tierbestand, wird die Prüfung beim nächsten Öffnen aktualisiert.</p>
    <div class="wf-table-wrap"><table class="wf-table"><tbody>
      ${row('Bestand zur letzten Jahreskontrolle (' + deDatum(b.von) + ')', b.anfang, 'wf-bestand-sum')}
      ${b.zugaenge.arten.map(a => row('+ ' + (BESTAND_ZUGANG_TEXT[a.art] || [a.label, a.label])[1], a.n)).join('')}
      ${b.abgaenge.arten.map(a => row('− ' + (BESTAND_ABGANG_TEXT[a.art] || [a.label, a.label])[1], a.n)).join('')}
      ${row('Bestand zum Kontrollzeitpunkt (' + deDatum(b.bis) + ')', b.endbestand, 'wf-bestand-sum')}
    </tbody></table></div>
  </section>`;
}

function generateKetteText(chk, ctx) {
  const stufen = chk.stufen || [];
  const lines = [];
  const klaerung = { bad: [], warn: [] };
  const quellen = new Set();
  const mitBilanz = bilanzAn(chk);
  lines.push(`Warenflussprüfung Warenflusskette — ${ctx.betrieb || '[Betrieb]'}`);
  lines.push(`Zeitraum: ${chk.zeitraum || '[Wirtschaftsjahr]'} · Kontrolle am ${ctx.datum || '[Datum]'}${ctx.kontrolleur ? ' · ' + ctx.kontrolleur : ''}`);
  lines.push('');
  const arten = [...new Set(stufen.map(s => STUFE_GRUNDLAGEN[s.art]))];
  lines.push('Grundlagen der Prüfung: ' + (arten.map(a => GRUNDLAGEN[a]).join(' ') || '[…]'));
  lines.push('');
  const verkauft = stufen.some(s => num(s.verkauf));
  lines.push('Warenfluss: ' + stufen.map((s, i) => {
    const src = s.quelleId ? stufeNr(chk, s.quelleId) : 0;
    return `${s.produkt || '[Produkt]'}${src && src !== i ? ` (aus Stufe ${src})` : ''}`;
  }).join(' → ') + (verkauft ? ' → Verkauf' : ''));
  lines.push('');

  stufen.forEach((s, i) => {
    const c = computeStufe(chk, s);
    const art = WF_STUFEN_ARTEN[s.art];
    const refLabel = s.refKey ? (stufeRefOptions(s.art).find(o => o.value === s.refKey) || {}).label : '';
    lines.push(`Stufe ${i + 1}: ${s.produkt || '[Produkt]'} — ${art.label}${refLabel ? ` (${refLabel})` : ''}`);
    const e = s.einheit || '';
    const status = c.status ? LEVEL_TEXT[c.status.level] : '[Bewertung]';
    const dev = c.status && c.status.dev != null ? ` (${devText(c.status)} zur Referenz)` : '';
    if (s.art === 'tier') lines.push(`– Erzeugung: ${L(num(s.basis), 0)} ${s.basisLabel || 'Tiere'} × Referenz ${L(num(s.refTyp), 1)} ${s.refEinheit || ''} (${quelleKurz(s)}) = erwartet ${L(c.erwartet, 0, e)}; angegeben ${L(num(s.erzeugt), 0, e)} (${L(c.kennzahl, 1)} je Tier) → ${status}${dev}.`);
    if (s.art === 'pflanze') lines.push(`– Ernte: ${L(num(s.basis), 2, 'ha')} × Referenz ${L(num(s.refTyp), 1, 'dt/ha')} (${quelleKurz(s)}) = erwartet ${L(c.erwartet, 0, e)}; angegeben ${L(num(s.erzeugt), 0, e)} (${L(c.kennzahl, 1, 'dt/ha')}) → ${status}${dev}.`);
    if (s.art === 'prozess') {
      const src = s.quelleId && stufen.find(x => x.id === s.quelleId);
      const herkunft = src ? `aus ${stufeName(chk, src)}` : 'aus Zukauf';
      lines.push(`– Verarbeitung: Einsatz ${L(num(s.basis), 0, s.ein || (src ? src.einheit : ''))} ${herkunft} × Ausbeute ${L(num(s.refTyp), 3)} (${quelleKurz(s)}) = erwartet ${L(c.erwartet, 0, e)}; erzeugt ${L(num(s.erzeugt), 0, e)} (Ausbeute ${L(c.kennzahl, 3)}) → ${status}${dev}.`);
    }
    if (s.art === 'ware') lines.push('– Bezug: Zukauf / Lagerware, keine eigene Erzeugung.');
    if (verbleibAn(chk, s)) {
      const weiter = c.abnehmer.length ? `, an ${c.abnehmer.map(x => stufeName(chk, x)).join(' und ')} ${L(c.weiter, 1, e)}` : '';
      const erz = s.art === 'ware' ? '' : `, Erzeugung ${L(num(s.erzeugt), 1, e)}`;
      lines.push(`– Verbleib: Anfangsbestand ${L(num(s.anfang), 1, e)}${erz}, Zukauf ${L(num(s.zukauf), 1, e)}, Verkauf ${L(num(s.verkauf), 1, e)}${weiter}, Eigenverbrauch/Verluste ${L(num(s.sonst), 1, e)} → Soll ${L(c.soll, 1, e)}, Inventur ${L(num(s.ende), 1, e)}, Differenz ${L(c.diff, 1, e)}${c.diffPct != null ? ` (${fmt(c.diffPct, 1)} %)` : ''} → ${c.bilanz ? LEVEL_TEXT[c.bilanz.level] : '[Bewertung]'}.`);
    } else if (c.abnehmer.length) {
      lines.push(`– Weitergabe an ${c.abnehmer.map(x => stufeName(chk, x)).join(' und ')}: ${L(c.weiter, 1, e)}.`);
    }
    if (s.refQuelle && WF_QUELLEN[s.refQuelle] && s.refQuelle !== 'annahme') quellen.add(WF_QUELLEN[s.refQuelle].titel);
    // Befunde über die bestehenden Formulierungen (Leistung/Ertrag/Ausbeute/Bilanz)
    const r = { ...s, _name: stufeName(chk, s) };
    const prodKey = { tier: 'leistung', pflanze: 'ertrag', prozess: 'ausbeute' }[s.art];
    const found = [];
    if (prodKey) found.push({ b: befund({ key: prodKey }, r, { status: c.status, jeTier: c.kennzahl, ertragHa: c.kennzahl, faktor: c.kennzahl, bedarf: null }), level: c.status && c.status.level });
    found.push({ b: befund({ key: 'bilanz' }, r, { status: c.bilanz, diff: c.diff, diffPct: c.diffPct }), level: c.bilanz && c.bilanz.level });
    const befunde = found.filter(x => x.b);
    if (befunde.length) {
      lines.push('Befund:');
      befunde.forEach(({ b, level }) => { lines.push('• ' + b.text); klaerung[level].push(b.klaerung); });
    }
    lines.push('');
  });

  const sum = summarizeWarenfluss(chk);
  const tolText = `Erzeugung ± ${fmt(chk.tolErtrag, 0)} %, Ausbeute ± ${fmt(chk.tolAusbeute ?? 5, 0)} %${mitBilanz || stufen.some(s => s.art === 'ware') ? `, Mengenbilanz ± ${fmt(chk.tolBilanz, 1)} %` : ''}`;
  pushErgebnis(lines, sum, tolText, klaerung, quellen);
  return lines.join('\n');
}

// ---------------- Oberfläche ----------------
let state = null; // { chk, ctx, onChange, onDelete, onClose }

function el(id) { return document.getElementById(id); }

export function openWarenfluss(chk, { ctx = {}, onChange = () => {}, onDelete = null, onClose = () => {} } = {}) {
  state = { chk, ctx, onChange, onDelete, onClose };
  const ov = el('warenfluss-overlay');
  el('wf-title').textContent = 'Warenflussprüfung · ' + WF_MODULE[chk.modul].label;
  el('wf-sub').textContent = [ctx.betrieb, ctx.datum].filter(Boolean).join(' · ');
  el('wf-icon').textContent = WF_MODULE[chk.modul].icon;
  el('wf-zeitraum').value = chk.zeitraum || '';
  closeZeitraumPop();
  el('wf-tol-ertrag').value = fmtIn(chk.tolErtrag);
  el('wf-tol-bilanz').value = fmtIn(chk.tolBilanz);
  el('wf-tol-ausbeute').value = fmtIn(chk.tolAusbeute ?? 5);
  el('wf-tol-ausbeute-wrap').hidden = chk.modul !== 'kette';
  el('wf-tol-ertrag-label').textContent = chk.modul === 'kette' ? 'Toleranz Erzeugung ±%' : 'Toleranz Referenz ±%';
  el('wf-delete').hidden = !onDelete;
  // Bestandsentwicklung: Zahlen und Zeitraum aus dem Tierbestand übernehmen
  // (falls für diesen Betrieb geladen), Toleranz gibt es dort nicht.
  el('wf-tol-ertrag').closest('label').hidden = chk.modul === 'bestand';
  if (chk.modul === 'bestand' && ctx.bestand) {
    chk.bestand = ctx.bestand;
    chk.zeitraumVon = ctx.bestand.von;
    chk.zeitraumBis = ctx.bestand.bis;
    chk.zeitraum = formatZeitraum(ctx.bestand.von, ctx.bestand.bis);
    el('wf-zeitraum').value = chk.zeitraum;
  }
  renderTables();
  setMode(chk.modus || 'tabelle');
  ov.hidden = false;
}
function closeWarenfluss() {
  const ov = el('warenfluss-overlay');
  if (ov.hidden) return;
  ov.hidden = true;
  const s = state;
  state = null;
  if (s) s.onClose(s.chk);
}
function touch() {
  state.chk.updatedAt = new Date().toISOString();
  state.onChange(state.chk);
  scheduleAutoText();
}
function setMode(mode) {
  state.chk.modus = mode;
  document.querySelectorAll('#wf-mode [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  el('wf-tables').hidden = mode !== 'tabelle';
  el('wf-auto').hidden = mode !== 'tabelle';
  el('wf-text-wrap').hidden = mode !== 'text';
  updateAutoText();
  if (mode === 'text') renderText();
}
function renderText() {
  const chk = state.chk;
  const ta = el('wf-text');
  ta.value = chk.freitext ?? (chk.autotext || generateWarenflussText(chk, state.ctx));
  el('wf-text-status').textContent = chk.freitext != null
    ? 'Von dir bearbeitet — wird nicht mehr automatisch überschrieben. „Aus Tabelle neu erzeugen" setzt ihn zurück.'
    : 'Automatisch aus der Tabelle geschrieben und laufend aktualisiert. [ ] und […] sind auszufüllende Stellen.';
  updateStaleBanner();
}
// Prüftext aus der aktuellen Berechnung — bei jeder Eingabe (leicht
// verzögert, damit schnelles Tippen flüssig bleibt). Unbearbeiteter Freitext
// folgt automatisch; bearbeiteter bekommt einen Hinweis, wenn die Tabelle
// sich danach geändert hat.
let autoTextTimer = null;
function scheduleAutoText() {
  clearTimeout(autoTextTimer);
  autoTextTimer = setTimeout(updateAutoText, 120);
}
function updateAutoText() {
  if (!state) return;
  const chk = state.chk;
  const text = generateWarenflussText(chk, state.ctx);
  chk.autotext = text;
  el('wf-auto-text').innerHTML = autoTextHtml(text);
  if (chk.freitext == null && chk.modus === 'text' && document.activeElement !== el('wf-text')) el('wf-text').value = text;
  updateStaleBanner();
}
function updateStaleBanner() {
  const chk = state && state.chk;
  el('wf-text-stale').hidden = !(chk && chk.freitext != null && chk.freitextBasis != null && chk.freitextBasis !== chk.autotext);
}
// Darstellung im Tabellen-Modus: Überschriften fett, Befunde/Ergebnis farbig.
function autoTextHtml(text) {
  const headings = new Set([...(TABLES[state.chk.modul] || []).map(t => t.title), 'Ergebnis', 'Befund:', 'Bestandsentwicklung im Zeitraum']);
  return text.split('\n').map(line => {
    if (!line.trim()) return '<div class="wf-auto-gap"></div>';
    const e = esc(line).replace(/\[[^\]]*\]/g, m => `<mark>${m}</mark>`);
    if (headings.has(line.trim()) || /^Stufe \d+: /.test(line)) return `<div class="wf-auto-h">${e}</div>`;
    if (line.startsWith('• ')) return `<div class="wf-auto-befund">${e}</div>`;
    if (/^\d+\. /.test(line)) return `<div class="wf-auto-klaerung">${e}</div>`;
    if (line.startsWith('Warenflussprüfung ')) return `<div class="wf-auto-title">${e}</div>`;
    return `<div>${e}</div>`;
  }).join('');
}

function unitFor(col, row) {
  if (col.unitFrom) return row[col.unitFrom] || '';
  return col.unit || '';
}
function cellHtml(t, col, row, c) {
  const unit = unitFor(col, row);
  if (col.type === 'select') {
    const optHtml = (o) => `<option value="${esc(o.value)}"${row[col.key] === o.value ? ' selected' : ''}>${esc(o.label)}</option>`;
    // Optionen mit "group" (z. B. Verarbeitung nach Branche) als <optgroup>.
    const groups = [];
    (col.options || []).forEach(o => {
      const g = o.group || '';
      let entry = groups.find(x => x.g === g);
      if (!entry) { entry = { g, items: [] }; groups.push(entry); }
      entry.items.push(o);
    });
    const opts = groups.map(({ g, items }) => (g ? `<optgroup label="${esc(g)}">${items.map(optHtml).join('')}</optgroup>` : items.map(optHtml).join(''))).join('');
    return `<select class="wf-input" data-field="${col.key}" aria-label="${esc(col.label)}"><option value="">– wählen –</option>${opts}</select>`
      + ((col.key === 'kultur' && row.kultur === 'sonstige') ? `<input class="wf-input wf-input-sub" data-field="kulturName" value="${esc(row.kulturName || '')}" placeholder="Name der Kultur" aria-label="Name der Kultur">` : '');
  }
  if (col.type === 'text') return `<input class="wf-input" data-field="${col.key}" value="${esc(row[col.key] ?? '')}" placeholder="${esc(col.placeholder || '')}" aria-label="${esc(col.label)}">`;
  if (col.type === 'num' || col.type === 'ref') {
    const val = fmtIn(row[col.key]);
    let refBadge = '';
    if (col.type === 'ref') {
      const q = WF_QUELLEN[row.refQuelle];
      const span = (num(row.refMin) != null || num(row.refMax) != null) ? `Spanne ${fmt(num(row.refMin), col.decimals || 2)}–${fmt(num(row.refMax), col.decimals || 2)}` : '';
      const tip = [q ? q.titel : '', span, row.refInfo].filter(Boolean).join(' · ');
      refBadge = q ? (q.url
        ? `<a class="wf-src${row.refQuelle === 'annahme' ? ' is-annahme' : ''}" href="${esc(q.url)}" target="_blank" rel="noopener" title="${esc(tip)}">${esc(q.kurz)}</a>`
        : `<span class="wf-src is-annahme" title="${esc(tip)}">${esc(q.kurz)}</span>`) : '';
    }
    return `<div class="wf-numcell"><input class="wf-input wf-num${col.type === 'ref' ? ' wf-ref' : ''}" data-field="${col.key}" value="${esc(val)}" inputmode="decimal" aria-label="${esc(col.label)}">${unit ? `<span class="wf-unit">${esc(unit)}</span>` : ''}</div>${refBadge}${row[col.key + 'Auto'] ? flaecheBadge(row[col.key + 'Info'] || '') : ''}`;
  }
  if (col.type === 'calc') {
    const v = c[col.key];
    return `<output class="wf-calc" data-calc="${col.key}">${fmt(v, col.decimals ?? (col.unit === '%' ? 1 : 1))}${v != null && unit && unit !== '%' ? ` <span class="wf-unit">${esc(unit)}</span>` : (v != null && unit === '%' ? ' %' : '')}</output>`;
  }
  if (col.type === 'status') return statusHtml(c[col.key]);
  return '';
}
function statusHtml(s) {
  if (!s) return '<span class="wf-status" data-calc="status">–</span>';
  return `<span class="wf-status is-${s.level}" data-calc="status"><span class="wf-dot" aria-hidden="true"></span>${LEVEL_TEXT[s.level]}${s.dev != null ? ` <small>${s.dev >= 0 ? '+' : ''}${fmt(s.dev, 0)} %</small>` : ''}</span>`;
}
function rowHtml(t, row) {
  const c = computeRow(t, row, state.chk);
  return `<tr data-row="${esc(row.id)}">${t.columns.map(col => `<td class="wf-col-${col.type}" data-col="${col.key}">${cellHtml(t, col, row, c)}</td>`).join('')}
    <td class="wf-col-del"><button type="button" class="wf-row-del" data-del-row="${esc(row.id)}" title="Zeile entfernen" aria-label="Zeile entfernen"><span class="material-symbols-rounded icon" aria-hidden="true">close</span></button></td></tr>`;
}
function footHtml(t) {
  const rows = state.chk.tables[t.key] || [];
  if (!t.columns.some(c => c.sum)) return '';
  const sums = {};
  t.columns.filter(c => c.sum).forEach(col => {
    let s = 0, any = false;
    rows.forEach(r => {
      const v = col.type === 'calc' ? computeRow(t, r, state.chk)[col.key] : num(r[col.key]);
      if (v != null) { s += v; any = true; }
    });
    sums[col.key] = any ? s : null;
  });
  return `<tfoot><tr>${t.columns.map((col, i) => `<td>${i === 0 ? 'Summe' : (col.sum ? `${fmt(sums[col.key], 1)}${sums[col.key] != null && col.unit ? ' ' + esc(col.unit) : ''}` : '')}</td>`).join('')}<td></td></tr></tfoot>`;
}
function tableHtml(t) {
  const rows = state.chk.tables[t.key] || (state.chk.tables[t.key] = []);
  const tolLabel = t.tol === 'tolBilanz' ? `Toleranz ± ${fmt(state.chk.tolBilanz, 1)} %` : `Toleranz ± ${fmt(state.chk.tolErtrag, 0)} %`;
  return `<section class="wf-section" data-table="${t.key}">
    <div class="wf-section-head"><h4>${esc(t.title)}</h4><div class="wf-section-tools"><span class="wf-tol-chip">${tolLabel}</span>${t.optional ? '<button type="button" class="wf-section-toggle" data-wf-bilanz="off" title="Mengenbilanz ausblenden — eingetragene Werte bleiben erhalten"><span class="material-symbols-rounded icon" aria-hidden="true">visibility_off</span>Ausblenden</button>' : ''}</div></div>
    <p class="wf-hint">${esc(t.hint)}</p>
    ${flaechenBarHtml(t)}
    <div class="wf-table-wrap"><table class="wf-table">
      <thead><tr>${t.columns.map(col => `<th class="wf-col-${col.type}">${esc(col.label)}${col.unit && col.type !== 'status' && !col.unitFrom ? `<small>${esc(col.unit)}</small>` : ''}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map(r => rowHtml(t, r)).join('')}</tbody>
      ${footHtml(t)}
    </table></div>
    <button type="button" class="wf-add-row" data-add-row="${t.key}"><span class="material-symbols-rounded icon" aria-hidden="true">add</span>Zeile hinzufügen</button>
  </section>`;
}
const BILANZ_ADD_HTML = (label, hint) => `<div class="wf-add-section-wrap"><button type="button" class="wf-add-section" data-wf-bilanz="on"><span class="material-symbols-rounded icon" aria-hidden="true">add</span>${label}</button><span class="wf-hint">${hint}</span></div>`;
// Ertrag/Saatgut: Flächen aus der Flächenübersicht übernehmen.
function flaechenBarHtml(t) {
  if (t.key !== 'ertrag' && t.key !== 'saat') return '';
  const fl = state.ctx.flaechen;
  if (!fl || !fl.length) return state.ctx.flaechenHinweis ? `<p class="wf-hint wf-fl-hint"><span class="material-symbols-rounded icon" aria-hidden="true">info</span>${esc(state.ctx.flaechenHinweis)}</p>` : '';
  return `<div class="wf-fl-bar"><button type="button" class="wf-add-row wf-fl-btn" data-wf-flaechen="${t.key}"><span class="material-symbols-rounded icon" aria-hidden="true">donut_small</span>Kulturen aus Flächenübersicht übernehmen</button><span class="wf-hint" id="wf-fl-status-${t.key}">Beim Wählen einer Kultur wird ihre Fläche automatisch eingetragen.</span></div>`;
}
// Legt je passender Kultur des Betriebs eine Zeile an (bzw. aktualisiert die
// Fläche vorhandener Zeilen, wenn sie nicht von Hand eingetragen wurde).
function uebernehmeFlaechen(tableKey) {
  const t = TABLES[state.chk.modul].find(x => x.key === tableKey);
  const rows = state.chk.tables[tableKey];
  const kulturCol = t.columns.find(c => c.key === 'kultur');
  let neu = 0, aktualisiert = 0;
  const benutzt = new Set();
  WF_KULTUREN.forEach(k => {
    const m = flaecheFuerKultur(state.ctx.flaechen, k.key);
    if (!m) return;
    m.labels.forEach(l => benutzt.add(l));
    let row = rows.find(r => r.kultur === k.key);
    if (!row) {
      // erste noch völlig leere Zeile wiederverwenden
      row = rows.find(r => !r.kultur && !rowHasInput(t, r));
      if (!row) { row = { id: uid(), ...t.newRow() }; rows.push(row); }
      row.kultur = k.key;
      kulturCol.onSelect(row, k.key);
      neu++;
    } else if (row.flaeche == null || row.flaecheAuto) {
      if (row.flaeche !== m.ha) aktualisiert++;
      fillFlaeche(row, k.key);
    }
  });
  const ohne = state.ctx.flaechen.filter(f => !benutzt.has(f.label)).map(f => f.label);
  touch();
  renderTables();
  const status = el('wf-fl-status-' + tableKey);
  if (status) status.textContent = (neu || aktualisiert ? `${neu} ${neu === 1 ? 'Kultur' : 'Kulturen'} übernommen${aktualisiert ? `, ${aktualisiert} aktualisiert` : ''}.` : 'Alle passenden Kulturen sind schon eingetragen.')
    + (ohne.length ? ` Ohne Referenzwert, nicht übernommen: ${ohne.join(', ')}.` : '');
}
function renderTables() {
  const chk = state.chk;
  el('wf-tol-bilanz-wrap').hidden = !(bilanzAn(chk) || (chk.modul === 'kette' && (chk.stufen || []).some(s => s.art === 'ware')));
  if (chk.modul === 'kette') { renderKette(); renderSummary(); return; }
  if (chk.modul === 'bestand') { renderBestand(); renderSummary(); return; }
  const tbls = visibleTables(chk);
  const hiddenOptional = (TABLES[chk.modul] || []).some(t => t.optional) && !bilanzAn(chk);
  el('wf-tables').innerHTML = tbls.map(tableHtml).join('')
    + (hiddenOptional ? BILANZ_ADD_HTML('Mengenbilanz (Warenfluss) hinzufügen', 'Anfangsbestand + Erzeugung + Zukauf − Abgänge gegen die Inventur — nur bei Bedarf.') : '');
  renderSummary();
}

// ---- Warenflusskette: Darstellung ----
function sfieldHtml(col, s, c) {
  return `<div class="wf-sfield wf-sfield-${col.type}${col.wide ? ' is-wide' : ''}" data-sfield="${col.key}"><span class="wf-sfield-label">${esc(col.label)}</span>${cellHtml(null, col, s, c)}</div>`;
}
function stufeHtml(chk, s, i) {
  const c = computeStufe(chk, s);
  const art = WF_STUFEN_ARTEN[s.art] || WF_STUFEN_ARTEN.prozess;
  const earlier = chk.stufen.slice(0, i);
  const quelleSel = s.art === 'prozess' ? `<label class="wf-stage-src"><span>Rohware aus</span><select class="wf-input" data-sf="quelleId" aria-label="Rohware aus">
      <option value="">Zukauf / extern</option>
      ${earlier.map(x => `<option value="${esc(x.id)}" data-stufe-opt="${esc(x.id)}"${s.quelleId === x.id ? ' selected' : ''}>${esc(stufeName(chk, x))}</option>`).join('')}
    </select></label>` : '';
  const src = s.quelleId && chk.stufen.find(x => x.id === s.quelleId);
  const unitWarn = src && s.art === 'prozess' && /^(kg|l|dt|t) /.test(s.ein || '') && !s.ein.startsWith(src.einheit + ' ')
    ? `<p class="wf-hint wf-stage-warn">Einheit der Vorstufe (${esc(src.einheit)}) und des Prozesses (${esc(s.ein)}) weichen ab — Mengen ggf. umrechnen (z. B. 1 l Milch ≈ 1,03 kg).</p>` : '';
  const prod = stufeProdCols(chk, s);
  return `<section class="wf-stage" data-stufe="${esc(s.id)}">
    <div class="wf-stage-head">
      <span class="wf-stage-nr" aria-hidden="true">${i + 1}</span>
      <select class="wf-input wf-stage-art" data-sf="art" aria-label="Art der Stufe">${Object.entries(WF_STUFEN_ARTEN).map(([k, a]) => `<option value="${k}"${s.art === k ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</select>
      <input class="wf-input wf-stage-produkt" data-sf="produkt" value="${esc(s.produkt || '')}" placeholder="Produkt, z. B. Milch" aria-label="Produkt der Stufe ${i + 1}">
      <select class="wf-input wf-stage-einheit" data-sf="einheit" aria-label="Einheit">${EINHEITEN.map(u => `<option${s.einheit === u ? ' selected' : ''}>${u}</option>`).join('')}</select>
      <button type="button" class="wf-row-del" data-stufe-del="${esc(s.id)}" title="Stufe entfernen" aria-label="Stufe ${i + 1} entfernen"><span class="material-symbols-rounded icon" aria-hidden="true">delete</span></button>
    </div>
    ${quelleSel}${unitWarn}
    ${prod.length ? `<div class="wf-stage-sub"><span class="material-symbols-rounded icon" aria-hidden="true">${art.icon}</span>${s.art === 'prozess' ? 'Verarbeitung' : 'Erzeugung'}</div>
    <div class="wf-sgrid">${prod.map(col => sfieldHtml(col, s, c)).join('')}</div>` : ''}
    ${verbleibAn(chk, s) ? `<div class="wf-stage-sub"><span class="material-symbols-rounded icon" aria-hidden="true">balance</span>Verbleib (Mengenbilanz)</div>
    <div class="wf-sgrid">${stufeBilanzCols(chk, s).map(col => sfieldHtml(col, s, c)).join('')}</div>` : ''}
  </section>`;
}
function flowHtml(chk) {
  const nodes = chk.stufen.map((s, i) => {
    const c = computeStufe(chk, s);
    const lv = [c.status, c.bilanz].filter(Boolean).map(x => x.level);
    const level = lv.includes('bad') ? 'bad' : lv.includes('warn') ? 'warn' : lv.length ? 'ok' : '';
    const menge = s.art === 'ware' ? num(s.zukauf) : num(s.erzeugt);
    const src = s.quelleId ? stufeNr(chk, s.quelleId) : 0;
    return `<div class="wf-flow-node${level ? ' is-' + level : ''}" data-flow="${i + 1}">
      <span class="wf-flow-nr">${i + 1}</span>
      <span class="wf-flow-main"><strong>${esc(s.produkt || 'Produkt …')}</strong><small>${menge != null ? esc(fmt(menge, 0) + ' ' + s.einheit) : esc(WF_STUFEN_ARTEN[s.art].label)}${src && src !== i ? ` · aus Stufe ${src}` : ''}</small></span>
    </div>`;
  });
  const verkauf = chk.stufen.filter(s => num(s.verkauf));
  if (verkauf.length) nodes.push(`<div class="wf-flow-node is-end"><span class="material-symbols-rounded icon" aria-hidden="true">storefront</span><span class="wf-flow-main"><strong>Verkauf</strong><small>${verkauf.map(s => esc(`${s.produkt || 'Stufe ' + stufeNr(chk, s.id)} ${fmt(num(s.verkauf), 0)} ${s.einheit}`)).join(' · ')}</small></span></div>`);
  return nodes.join('<span class="material-symbols-rounded icon wf-flow-arrow" aria-hidden="true">arrow_forward</span>');
}
function renderKette() {
  const chk = state.chk;
  chk.stufen = chk.stufen || [];
  el('wf-tables').innerHTML = `<section class="wf-section wf-kette">
    <div class="wf-section-head"><h4>Warenflusskette</h4><div class="wf-section-tools"><span class="wf-tol-chip">Erzeugung ± ${fmt(chk.tolErtrag, 0)} % · Ausbeute ± ${fmt(chk.tolAusbeute ?? 5, 0)} %</span>${bilanzAn(chk) ? '<button type="button" class="wf-section-toggle" data-wf-bilanz="off" title="Verbleib/Mengenbilanz ausblenden — eingetragene Werte bleiben erhalten"><span class="material-symbols-rounded icon" aria-hidden="true">visibility_off</span>Mengenbilanz ausblenden</button>' : ''}</div></div>
    <p class="wf-hint">Stufen bauen aufeinander auf: Eine Verarbeitung nimmt ihre Rohware aus einer früheren Stufe — der Einsatz zählt dort als Abgang „an Folgestufe(n)". Mehrere Verarbeitungen aus derselben Stufe sind möglich (z. B. Milch → Käse und Butter).</p>
    <div class="wf-flow" id="wf-flow">${flowHtml(chk)}</div>
    ${bilanzAn(chk) ? '' : BILANZ_ADD_HTML('Mengenbilanz (Verbleib je Stufe) einblenden', 'Bestände, Verkauf und Inventur je Stufe — nur bei Bedarf.')}
    <div class="wf-stages">${chk.stufen.map((s, i) => stufeHtml(chk, s, i)).join('<span class="material-symbols-rounded icon wf-stage-arrow" aria-hidden="true">arrow_downward</span>')}</div>
    <button type="button" class="wf-add-row" data-stufe-add><span class="material-symbols-rounded icon" aria-hidden="true">add</span>Stufe hinzufügen</button>
  </section>`;
}
// Nach einer Zahleneingabe: alle berechneten Felder und das Flussbild
// aktualisieren (ein Einsatz unten ändert den Verbleib oben).
function refreshKette() {
  const chk = state.chk;
  chk.stufen.forEach(s => {
    const sec = el('wf-tables').querySelector(`.wf-stage[data-stufe="${CSS.escape(s.id)}"]`);
    if (!sec) return;
    const c = computeStufe(chk, s);
    [...stufeProdCols(chk, s), ...stufeBilanzCols(chk, s)].forEach(col => {
      if (col.type !== 'calc' && col.type !== 'status') return;
      const f = sec.querySelector(`.wf-sfield[data-sfield="${col.key}"]`);
      if (f) f.outerHTML = sfieldHtml(col, s, c);
    });
  });
  const flow = el('wf-flow');
  if (flow) flow.innerHTML = flowHtml(chk);
  renderSummary();
}
function renderSummary() {
  const s = summarizeWarenfluss(state.chk);
  el('wf-summary').innerHTML = `<span class="wf-status is-ok"><span class="wf-dot"></span>${s.ok} plausibel</span>
    <span class="wf-status is-warn"><span class="wf-dot"></span>${s.warn} prüfen</span>
    <span class="wf-status is-bad"><span class="wf-dot"></span>${s.bad} auffällig</span>`;
}
function findRow(tableKey, rowId) {
  return (state.chk.tables[tableKey] || []).find(r => r.id === rowId);
}
function refreshRow(tr, t, row) {
  const c = computeRow(t, row, state.chk);
  t.columns.forEach(col => {
    if (col.type !== 'calc' && col.type !== 'status') return;
    const td = tr.querySelector(`td[data-col="${col.key}"]`);
    if (td) td.innerHTML = cellHtml(t, col, row, c);
  });
  const section = tr.closest('.wf-section');
  const tfoot = section.querySelector('tfoot');
  if (tfoot) tfoot.outerHTML = footHtml(t);
  renderSummary();
}

let wired = false;
export function initWarenflussUi() {
  if (wired) return;
  wired = true;
  const tablesEl = el('wf-tables');
  tablesEl.addEventListener('input', (e) => {
    if (!state) return;
    const stage = e.target.closest('.wf-stage');
    if (stage) {
      const s = state.chk.stufen.find(x => x.id === stage.dataset.stufe);
      const input = e.target.closest('[data-field], [data-sf]');
      if (!s || !input || input.tagName === 'SELECT') return;
      if (input.dataset.sf === 'produkt') {
        s.produkt = input.value;
        tablesEl.querySelectorAll(`option[data-stufe-opt="${CSS.escape(s.id)}"]`).forEach(o => { o.textContent = stufeName(state.chk, s); });
      } else {
        s[input.dataset.field] = num(input.value);
        if (input.dataset.field === 'basis' && s.basisAuto) { s.basisAuto = false; input.closest('.wf-sfield').querySelector('.wf-fl-src')?.remove(); }
      }
      touch();
      refreshKette();
      return;
    }
    const input = e.target.closest('[data-field]');
    if (!input) return;
    const tr = input.closest('tr'), section = input.closest('.wf-section');
    const t = TABLES[state.chk.modul].find(x => x.key === section.dataset.table);
    const row = findRow(t.key, tr.dataset.row);
    if (!row || input.tagName === 'SELECT') return;
    const col = t.columns.find(c => c.key === input.dataset.field);
    row[input.dataset.field] = col && (col.type === 'num' || col.type === 'ref') ? num(input.value) : input.value;
    if (input.dataset.field === 'flaeche' && row.flaecheAuto) { row.flaecheAuto = false; input.closest('td').querySelector('.wf-fl-src')?.remove(); }
    touch();
    refreshRow(tr, t, row);
  });
  tablesEl.addEventListener('change', (e) => {
    if (!state) return;
    const stage = e.target.closest('.wf-stage');
    if (stage) {
      const s = state.chk.stufen.find(x => x.id === stage.dataset.stufe);
      const sel = e.target.closest('select');
      if (!s || !sel) return;
      const f = sel.dataset.sf || sel.dataset.field;
      if (f === 'art') {
        s.art = sel.value;
        Object.assign(s, refFrom(null), { refKey: '', basisLabel: '', ein: '', aus: '' });
        if (s.art !== 'prozess') s.quelleId = '';
        if (s.art === 'pflanze') s.einheit = 'dt';
      } else if (f === 'refKey') applyStufeRef(s, sel.value);
      else if (f === 'einheit') s.einheit = sel.value;
      else if (f === 'quelleId') s.quelleId = sel.value;
      else return;
      touch();
      renderTables();
      return;
    }
    const sel = e.target.closest('select[data-field]');
    if (!sel) return;
    const tr = sel.closest('tr'), section = sel.closest('.wf-section');
    const t = TABLES[state.chk.modul].find(x => x.key === section.dataset.table);
    const row = findRow(t.key, tr.dataset.row);
    const col = t.columns.find(c => c.key === sel.dataset.field);
    row[sel.dataset.field] = sel.value;
    if (col && col.onSelect) col.onSelect(row, sel.value);
    touch();
    tr.outerHTML = rowHtml(t, row);
    const fresh = tablesEl.querySelector(`tr[data-row="${CSS.escape(row.id)}"]`);
    if (fresh) refreshRow(fresh, t, row);
  });
  tablesEl.addEventListener('click', (e) => {
    if (!state) return;
    const flBtn = e.target.closest('[data-wf-flaechen]');
    if (flBtn) { uebernehmeFlaechen(flBtn.dataset.wfFlaechen); return; }
    const tog = e.target.closest('[data-wf-bilanz]');
    if (tog) {
      state.chk.mitBilanz = tog.dataset.wfBilanz === 'on';
      touch();
      renderTables();
      return;
    }
    if (e.target.closest('[data-stufe-add]')) {
      const st = state.chk.stufen;
      const last = st[st.length - 1];
      st.push(newStufe('prozess', last ? last.id : ''));
      touch();
      renderTables();
      el('wf-tables').querySelector('.wf-stage:last-of-type [data-sf="produkt"]')?.focus();
      return;
    }
    const sdel = e.target.closest('[data-stufe-del]');
    if (sdel) {
      const st = state.chk.stufen;
      const s = st.find(x => x.id === sdel.dataset.stufeDel);
      if (!s) return;
      const hasData = ['basis', 'erzeugt', 'anfang', 'zukauf', 'verkauf', 'sonst', 'ende'].some(k => num(s[k]) != null) || s.produkt;
      if (hasData && !confirm(`Stufe ${stufeNr(state.chk, s.id)}${s.produkt ? ' (' + s.produkt + ')' : ''} entfernen?`)) return;
      state.chk.stufen = st.filter(x => x.id !== s.id);
      state.chk.stufen.forEach(x => { if (x.quelleId === s.id) x.quelleId = s.quelleId || ''; });
      touch();
      renderTables();
      return;
    }
    const add = e.target.closest('[data-add-row]');
    if (add) {
      const t = TABLES[state.chk.modul].find(x => x.key === add.dataset.addRow);
      state.chk.tables[t.key].push({ id: uid(), ...t.newRow() });
      touch();
      renderTables();
      const rows = tablesEl.querySelectorAll(`.wf-section[data-table="${t.key}"] tbody tr`);
      rows[rows.length - 1]?.querySelector('.wf-input')?.focus();
      return;
    }
    const del = e.target.closest('[data-del-row]');
    if (del) {
      const section = del.closest('.wf-section');
      const key = section.dataset.table;
      state.chk.tables[key] = state.chk.tables[key].filter(r => r.id !== del.dataset.delRow);
      touch();
      renderTables();
    }
  });
  el('wf-zeitraum').addEventListener('input', (e) => {
    if (!state) return;
    state.chk.zeitraum = e.target.value;
    const r = parseZeitraum(e.target.value);
    state.chk.zeitraumVon = r ? r.von : null;
    state.chk.zeitraumBis = r ? r.bis : null;
    if (!el('wf-zeitraum-pop').hidden) syncZeitraumPop();
    touch();
  });
  // Zeitraum per Kalender
  el('wf-zeitraum-cal').addEventListener('click', () => (el('wf-zeitraum-pop').hidden ? openZeitraumPop() : closeZeitraumPop()));
  el('wf-zr-done').addEventListener('click', closeZeitraumPop);
  el('wf-zr-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-von]');
    if (b) setZeitraum(b.dataset.von, b.dataset.bis);
  });
  const onDate = () => {
    const von = el('wf-zr-von').value, bis = el('wf-zr-bis').value;
    const hint = el('wf-zr-hint');
    if (von && bis && von > bis) { hint.textContent = '„Bis“ liegt vor „Von“.'; hint.hidden = false; return; }
    hint.hidden = true;
    if (von && bis) setZeitraum(von, bis);
  };
  el('wf-zr-von').addEventListener('change', onDate);
  el('wf-zr-bis').addEventListener('change', onDate);
  document.addEventListener('pointerdown', (e) => {
    const pop = el('wf-zeitraum-pop');
    if (!pop.hidden && !e.target.closest('.wf-zeitraum-field')) closeZeitraumPop();
  });
  const tolInput = (id, key) => el(id).addEventListener('input', (e) => {
    if (!state) return;
    const v = num(e.target.value);
    if (v == null || v < 0) return;
    state.chk[key] = v;
    touch();
    renderTables();
  });
  tolInput('wf-tol-ertrag', 'tolErtrag');
  tolInput('wf-tol-bilanz', 'tolBilanz');
  tolInput('wf-tol-ausbeute', 'tolAusbeute');
  document.querySelectorAll('#wf-mode [data-mode]').forEach(b => b.addEventListener('click', () => { if (state) { setMode(b.dataset.mode); touch(); } }));
  el('wf-text').addEventListener('input', (e) => {
    if (!state) return;
    if (state.chk.freitext == null) state.chk.freitextBasis = state.chk.autotext;
    state.chk.freitext = e.target.value;
    touch();
    el('wf-text-status').textContent = 'Von dir bearbeitet — wird nicht mehr automatisch überschrieben. „Aus Tabelle neu erzeugen" setzt ihn zurück.';
  });
  el('wf-text-stale-update').addEventListener('click', () => {
    if (!state) return;
    if (!confirm('Deine Textänderungen durch den aktuellen Prüftext aus der Tabelle ersetzen?')) return;
    state.chk.freitext = null;
    state.chk.freitextBasis = null;
    touch();
    updateAutoText();
    renderText();
  });
  el('wf-auto-edit').addEventListener('click', () => { if (state) { setMode('text'); touch(); el('wf-text').focus(); } });
  el('wf-auto-copy').addEventListener('click', async () => {
    if (!state) return;
    const text = state.chk.autotext || generateWarenflussText(state.chk, state.ctx);
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    const btn = el('wf-auto-copy');
    btn.lastChild.textContent = ok ? 'Kopiert' : 'Nicht möglich';
    setTimeout(() => { btn.lastChild.textContent = 'Kopieren'; }, 1600);
  });
  el('wf-text-regen').addEventListener('click', () => {
    if (!state) return;
    if (state.chk.freitext != null && !confirm('Bearbeiteten Text durch eine neu erzeugte Fassung ersetzen?')) return;
    state.chk.freitext = null;
    state.chk.freitextBasis = null;
    touch();
    updateAutoText();
    renderText();
  });
  el('wf-text-copy').addEventListener('click', async () => {
    const ta = el('wf-text');
    let ok = false;
    try { await navigator.clipboard.writeText(ta.value); ok = true; } catch { ta.select(); try { ok = document.execCommand('copy'); } catch {} }
    el('wf-text-status').textContent = ok ? 'In die Zwischenablage kopiert.' : 'Kopieren nicht möglich — bitte Text markieren und kopieren.';
  });
  el('wf-close').addEventListener('click', closeWarenfluss);
  el('wf-done').addEventListener('click', closeWarenfluss);
  el('wf-delete').addEventListener('click', () => {
    if (!state || !state.onDelete) return;
    if (!confirm('Diese Warenflussprüfung löschen?')) return;
    const s = state;
    el('warenfluss-overlay').hidden = true;
    state = null;
    s.onDelete(s.chk);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el('warenfluss-overlay').hidden) return;
    e.stopImmediatePropagation();
    // Escape schließt zuerst die Kalenderauswahl, dann die Prüfung.
    if (!el('wf-zeitraum-pop').hidden) closeZeitraumPop(); else closeWarenfluss();
  }, true);
}

// ---- Zeitraum: Text <-> Von/Bis ----
// "2025" = Kalenderjahr, "2024/25" = Wirtschaftsjahr (1.7.–30.6.),
// "01.07.2024–30.06.2025" = freier Zeitraum. Ganze Kalenderjahre werden als
// Jahreszahl geschrieben, alles andere als Datumsbereich.
const isoOf = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const deDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
export function parseZeitraum(text) {
  const t = String(text || '').trim();
  let m = /^(\d{4})$/.exec(t);
  if (m) return { von: isoOf(+m[1], 1, 1), bis: isoOf(+m[1], 12, 31) };
  m = /^(?:WJ\s*)?(\d{4})\s*\/\s*(\d{2}|\d{4})$/i.exec(t);
  if (m) {
    const y = +m[1];
    return { von: isoOf(y, 7, 1), bis: isoOf(y + 1, 6, 30) };
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[–—-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) return { von: isoOf(+m[3], +m[2], +m[1]), bis: isoOf(+m[6], +m[5], +m[4]) };
  return null;
}
export function formatZeitraum(von, bis) {
  const [vy, vm, vd] = von.split('-'), [by, bm, bd] = bis.split('-');
  if (vy === by && vm === '01' && vd === '01' && bm === '12' && bd === '31') return vy;
  return `${deDate(von)}–${deDate(bis)}`;
}
function zeitraumPresets() {
  const y = new Date().getFullYear();
  return [
    { label: `Kalenderjahr ${y - 1}`, von: isoOf(y - 1, 1, 1), bis: isoOf(y - 1, 12, 31) },
    { label: `Kalenderjahr ${y}`, von: isoOf(y, 1, 1), bis: isoOf(y, 12, 31) },
    { label: `WJ ${y - 2}/${String(y - 1).slice(2)}`, von: isoOf(y - 2, 7, 1), bis: isoOf(y - 1, 6, 30) },
    { label: `WJ ${y - 1}/${String(y).slice(2)}`, von: isoOf(y - 1, 7, 1), bis: isoOf(y, 6, 30) }
  ];
}
function syncZeitraumPop() {
  const r = state && (state.chk.zeitraumVon && state.chk.zeitraumBis
    ? { von: state.chk.zeitraumVon, bis: state.chk.zeitraumBis }
    : parseZeitraum(state.chk.zeitraum));
  el('wf-zr-von').value = r ? r.von : '';
  el('wf-zr-bis').value = r ? r.bis : '';
  el('wf-zr-hint').hidden = true;
  el('wf-zr-presets').innerHTML = zeitraumPresets().map(p => {
    const on = r && r.von === p.von && r.bis === p.bis;
    return `<button type="button" class="wf-zr-chip" data-von="${p.von}" data-bis="${p.bis}" aria-pressed="${on ? 'true' : 'false'}">${esc(p.label)}</button>`;
  }).join('');
}
function openZeitraumPop() {
  if (!state) return;
  syncZeitraumPop();
  el('wf-zeitraum-pop').hidden = false;
  el('wf-zeitraum-cal').setAttribute('aria-expanded', 'true');
}
function closeZeitraumPop() {
  el('wf-zeitraum-pop').hidden = true;
  el('wf-zeitraum-cal').setAttribute('aria-expanded', 'false');
}
function setZeitraum(von, bis) {
  if (!state) return;
  state.chk.zeitraumVon = von;
  state.chk.zeitraumBis = bis;
  state.chk.zeitraum = formatZeitraum(von, bis);
  el('wf-zeitraum').value = state.chk.zeitraum;
  syncZeitraumPop();
  touch();
}

// Für die Liste im Termin: kurze Beschreibung einer Prüfung.
export function warenflussRowInfo(chk) {
  const s = summarizeWarenfluss(chk);
  const pfad = chk.modul === 'kette' ? (chk.stufen || []).map(x => x.produkt).filter(Boolean).join(' → ') : '';
  return { titel: chk.titel || WF_MODULE[chk.modul].label, icon: WF_MODULE[chk.modul].icon, zeitraum: chk.zeitraum, summary: s, pfad };
}
export function warenflussTablesFor(modul) { return (TABLES[modul] || []).map(t => t.key); }
