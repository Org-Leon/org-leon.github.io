// ---------- Warenflussprüfung (Kontrolle) ----------
// Eigenständiges Modul wie flaechenuebersicht.js: Prüfbereiche (Pflanzenbau,
// Tierhaltung, Imkerei, Verarbeitung, Handel) mit Tabellen, die gegen
// recherchierte Referenzwerte rechnen (warenfluss-referenzen.js), plus ein
// vorformulierter Freitext. Eine Prüfung gehört zu einem Termin
// (ev.warenfluss, siehe main.js) und wird mit dem Termin gespeichert.
//
// Datenform einer Prüfung:
//   { id, modul, titel, zeitraum, modus: 'tabelle'|'text', tolErtrag, tolBilanz,
//     tables: { [tabelle]: [zeilen] }, freitext: string|null, createdAt, updatedAt }
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
  handel: { label: 'Handel', icon: 'compare_arrows', sub: 'Bestand, Zukauf, Verkauf, Schwund' }
};

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
    key: 'bilanz', title: 'Mengenbilanz (Warenfluss)', tol: 'tolBilanz',
    hint: 'Anfangsbestand + Erzeugung + Zukauf − Verkauf − Eigenverbrauch/Verluste = Soll-Endbestand. Die Differenz zur Inventur wird gegen die Bilanz-Toleranz geprüft.',
    columns: cols,
    newRow: () => ({ einheit: opts.einheit || 'dt' })
  };
}

const TABLES = {
  pflanzenbau: [
    {
      key: 'ertrag', title: 'Ernte und Ertrag je Hektar', tol: 'tolErtrag',
      hint: 'Angegebene Erntemenge im Vergleich zum Referenzertrag. Referenzen sind Mittelwerte — Standort und Jahr können deutlich abweichen.',
      refKey: 'kultur',
      columns: [
        { key: 'kultur', label: 'Kultur', type: 'select', width: 170, options: WF_KULTUREN.map(k => ({ value: k.key, label: k.label })),
          onSelect: (row, v) => { const k = WF_KULTUREN.find(x => x.key === v); Object.assign(row, refFrom(k && k.ertrag)); if (k && k.key !== 'sonstige') row.kulturName = k.label; } },
        { key: 'flaeche', label: 'Fläche', unit: 'ha', type: 'num', sum: true },
        { key: 'refTyp', label: 'Referenz', unit: 'dt/ha', type: 'ref' },
        { key: 'erwartet', label: 'Ernte erwartet', unit: 'dt', type: 'calc', sum: true, calc: r => (num(r.flaeche) != null && num(r.refTyp) != null ? num(r.flaeche) * num(r.refTyp) : null) },
        { key: 'ernte', label: 'Ernte angegeben', unit: 'dt', type: 'num', sum: true },
        { key: 'ertragHa', label: 'Ertrag', unit: 'dt/ha', type: 'calc', calc: r => (num(r.ernte) != null && num(r.flaeche) ? num(r.ernte) / num(r.flaeche) : null) },
        { key: 'status', label: 'Bewertung', type: 'status', calc: (r, c, chk) => rateAgainstRef(c.ertragHa, r, chk.tolErtrag) }
      ],
      newRow: () => ({})
    },
    {
      key: 'saat', title: 'Saat- und Pflanzgut', tol: 'tolErtrag',
      hint: 'Eingesetzte Menge (eigenes + zugekauftes Öko-Saatgut) im Vergleich zum Bedarf aus der Saatstärke. Tausendkornmassen sind sortenabhängig — Referenz ggf. anpassen.',
      columns: [
        { key: 'kultur', label: 'Kultur', type: 'select', width: 170, options: WF_KULTUREN.map(k => ({ value: k.key, label: k.label })),
          onSelect: (row, v) => { const k = WF_KULTUREN.find(x => x.key === v); Object.assign(row, refFrom(k && k.saat)); } },
        { key: 'flaeche', label: 'Fläche', unit: 'ha', type: 'num', sum: true },
        { key: 'refTyp', label: 'Bedarf je ha', unit: 'kg/ha', type: 'ref' },
        { key: 'bedarf', label: 'Bedarf gesamt', unit: 'kg', type: 'calc', sum: true, calc: r => (num(r.flaeche) != null && num(r.refTyp) != null ? num(r.flaeche) * num(r.refTyp) : null) },
        { key: 'eingesetzt', label: 'Eingesetzt', unit: 'kg', type: 'num', sum: true },
        { key: 'jeHa', label: 'Eingesetzt je ha', unit: 'kg/ha', type: 'calc', calc: r => (num(r.eingesetzt) != null && num(r.flaeche) ? num(r.eingesetzt) / num(r.flaeche) : null) },
        { key: 'status', label: 'Bewertung', type: 'status', calc: (r, c, chk) => rateAgainstRef(c.jeHa, r, chk.tolErtrag) }
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
        { key: 'prozess', label: 'Prozess', type: 'select', width: 210, options: WF_PROZESSE.map(p => ({ value: p.key, label: p.label })),
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
    bilanzTable({ noZugang: true, sonstLabel: 'Schwund / Verderb', einheit: 'kg' })
  ]
};
// Handel: mehr Spielraum? Nein — Toleranz ist in jeder Prüfung einstellbar.

export function createWarenfluss(modul) {
  const tables = {};
  (TABLES[modul] || []).forEach(t => { tables[t.key] = [{ id: uid(), ...t.newRow() }]; });
  return {
    id: uid(), modul, titel: WF_MODULE[modul].label, zeitraum: String(new Date().getFullYear() - 1),
    modus: 'tabelle', tolErtrag: 25, tolBilanz: 2, tables, freitext: null,
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
  (TABLES[chk.modul] || []).forEach(t => (chk.tables[t.key] || []).forEach(r => {
    const s = computeRow(t, r, chk).status;
    if (s && out[s.level] != null) out[s.level]++;
  }));
  return out;
}

// ---- Freitext ----
const L = (v, d = 1, unit = '') => (v == null ? '[…]' : fmt(v, d) + (unit ? ' ' + unit : ''));
const optLabel = (table, key, value) => {
  const col = table.columns.find(c => c.key === key);
  const o = col && col.options && col.options.find(x => x.value === value);
  return o ? o.label : (value || '[…]');
};
const quelleKurz = (row) => (row.refQuelle && WF_QUELLEN[row.refQuelle] ? WF_QUELLEN[row.refQuelle].kurz : 'eigene Angabe');

export function generateWarenflussText(chk, ctx) {
  const tbls = TABLES[chk.modul] || [];
  const lines = [];
  lines.push(`Warenflussprüfung ${WF_MODULE[chk.modul].label} — ${ctx.betrieb || '[Betrieb]'}`);
  lines.push(`Zeitraum: ${chk.zeitraum || '[Wirtschaftsjahr]'} · Kontrolle am ${ctx.datum || '[Datum]'}${ctx.kontrolleur ? ' · ' + ctx.kontrolleur : ''}`);
  lines.push('');
  lines.push('Grundlagen der Prüfung: ' + ({
    pflanzenbau: 'Flächennachweis/Anbauplan, Ernte- und Lageraufzeichnungen, Saatgutbelege (inkl. Öko-Saatgut-Nachweise bzw. Ausnahmegenehmigungen), Verkaufs- und Lieferbelege, Inventur.',
    tierhaltung: 'Bestandsregister, Zu- und Abgangsbelege der Tiere, Futtermittelbelege und -aufzeichnungen, Milchgeld-/Eierabrechnungen, Schlachtbelege, Inventur.',
    imkerei: 'Völkerverzeichnis und Standortplan, Ernteaufzeichnungen, Belege über Wachs und Futter (Öko-Zucker/-Honig), Verkaufsbelege, Lagerbestand.',
    verarbeitung: 'Rezepturen, Produktionsprotokolle, Wareneingangsbelege (Öko-Zertifikate der Lieferanten), Warenausgangsbelege, Inventur von Rohware und Fertigprodukten.',
    handel: 'Zukaufsbelege mit Öko-Kennzeichnung und Zertifikaten der Lieferanten, Verkaufsbelege, Lagerbuchhaltung, Inventur.'
  }[chk.modul]));
  lines.push('');

  tbls.forEach(t => {
    const rows = (chk.tables[t.key] || []).filter(r => rowHasInput(t, r));
    lines.push(t.title + ':');
    if (!rows.length) { lines.push('– [nicht geprüft / keine Angaben]'); lines.push(''); return; }
    rows.forEach(r => {
      const c = computeRow(t, r, chk);
      const status = c.status ? LEVEL_TEXT[c.status.level] : '[Bewertung]';
      const dev = c.status && c.status.dev != null ? ` (${c.status.dev >= 0 ? '+' : ''}${fmt(c.status.dev, 0)} % zur Referenz)` : '';
      if (t.key === 'ertrag') {
        const name = r.kultur === 'sonstige' || !r.kultur ? (r.kulturName || '[Kultur]') : optLabel(t, 'kultur', r.kultur);
        lines.push(`– ${name}: ${L(num(r.flaeche), 2, 'ha')}, angegebene Ernte ${L(num(r.ernte), 1, 'dt')} = ${L(c.ertragHa, 1, 'dt/ha')}. Referenz ${L(num(r.refTyp), 1, 'dt/ha')} (${quelleKurz(r)}). Ergebnis: ${status}${dev}.`);
      } else if (t.key === 'saat') {
        lines.push(`– ${optLabel(t, 'kultur', r.kultur)}: ${L(num(r.flaeche), 2, 'ha')}, eingesetzt ${L(num(r.eingesetzt), 0, 'kg')} = ${L(c.jeHa, 0, 'kg/ha')}; Bedarf lt. Referenz ${L(num(r.refTyp), 0, 'kg/ha')} (${quelleKurz(r)}). Ergebnis: ${status}${dev}. Herkunft des Saatguts (Öko / Ausnahmegenehmigung): [ ].`);
      } else if (t.key === 'leistung') {
        lines.push(`– ${optLabel(t, 'tierart', r.tierart)}: ${L(num(r.anzahl), 0)} (${r.basis || 'Anzahl'}), ${r.produktLabel || 'Leistung'} angegeben ${L(num(r.angegeben), 0)} = ${L(c.jeTier, 1)} ${r.refEinheit || ''}; Referenz ${L(num(r.refTyp), 1)} (${quelleKurz(r)}). Ergebnis: ${status}${dev}.`);
      } else if (t.key === 'futter') {
        lines.push(`– ${optLabel(t, 'tierart', r.tierart)}: Bedarf ${L(c.bedarf, 0, 'kg')} (${L(num(r.refTyp), 1)} ${r.refEinheit || ''}, ${quelleKurz(r)}), verfügbar ${L(num(r.verfuegbar), 0, 'kg')}. Ergebnis: ${status}${dev}. Futterzukauf ausschließlich Öko-Ware: [ja / nein].`);
      } else if (t.key === 'honig') {
        lines.push(`– ${r.standort || 'Stand'}: ${L(num(r.voelker), 0, 'Völker')}, geerntet ${L(num(r.geerntet), 0, 'kg')} = ${L(c.jeVolk, 1, 'kg/Volk')}; Referenz ${L(num(r.refTyp), 1, 'kg/Volk')} (${quelleKurz(r)}). Ergebnis: ${status}${dev}.`);
      } else if (t.key === 'ausbeute') {
        lines.push(`– ${optLabel(t, 'prozess', r.prozess)}: Einsatz ${L(num(r.einsatz), 0, r.ein || '')}, erzeugt ${L(num(r.erzeugt), 0, r.aus || '')} (Ausbeute ${L(c.faktor, 3)}); erwartet ${L(c.erwartet, 0, r.aus || '')} bei Faktor ${L(num(r.refTyp), 3)} (${quelleKurz(r)}). Ergebnis: ${status}${dev}.`);
      } else if (t.key === 'bilanz') {
        const e = r.einheit || '';
        lines.push(`– ${r.produkt || '[Produkt]'}: Anfangsbestand ${L(num(r.anfang), 1, e)}${'zugang' in r || t.columns.some(cc => cc.key === 'zugang') ? `, Erzeugung ${L(num(r.zugang), 1, e)}` : ''}, Zukauf ${L(num(r.zukauf), 1, e)}, Verkauf ${L(num(r.verkauf), 1, e)}, Eigenverbrauch/Verluste ${L(num(r.sonst), 1, e)} → Soll-Endbestand ${L(c.soll, 1, e)}, Inventur ${L(num(r.ende), 1, e)}, Differenz ${L(c.diff, 1, e)}${c.diffPct != null ? ` (${fmt(c.diffPct, 1)} %)` : ''}. Ergebnis: ${status}.`);
      }
    });
    lines.push('');
  });

  const sum = summarizeWarenfluss(chk);
  const gesamt = sum.bad ? 'nicht plausibel — Abweichungen sind zu klären' : sum.warn ? 'im Wesentlichen plausibel, einzelne Punkte sind zu prüfen' : (sum.ok ? 'plausibel' : '[plausibel / nicht plausibel]');
  lines.push(`Gesamtergebnis: Der Warenfluss ist ${gesamt}.`);
  lines.push(`Toleranzen: Referenzwerte ± ${fmt(chk.tolErtrag, 0)} %, Mengenbilanz ± ${fmt(chk.tolBilanz, 1)} %.`);
  lines.push('Erläuterung der Abweichungen durch den Betrieb: [ ]');
  lines.push('Festgestellte Mängel / Maßnahmen: [keine]');
  lines.push('Nachweise nachzureichen bis: [ ]');
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
  el('wf-tol-ertrag').value = fmtIn(chk.tolErtrag);
  el('wf-tol-bilanz').value = fmtIn(chk.tolBilanz);
  el('wf-delete').hidden = !onDelete;
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
}
function setMode(mode) {
  state.chk.modus = mode;
  document.querySelectorAll('#wf-mode [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  el('wf-tables').hidden = mode !== 'tabelle';
  el('wf-text-wrap').hidden = mode !== 'text';
  if (mode === 'text') renderText();
}
function renderText() {
  const chk = state.chk;
  const ta = el('wf-text');
  const generated = generateWarenflussText(chk, state.ctx);
  ta.value = chk.freitext ?? generated;
  el('wf-text-status').textContent = chk.freitext != null
    ? 'Text wurde bearbeitet — Änderungen in der Tabelle fließen erst nach „Aus Tabelle neu erzeugen" ein.'
    : 'Vorformuliert aus der Tabelle. [ ] und […] sind auszufüllende Stellen.';
}

function unitFor(col, row) {
  if (col.unitFrom) return row[col.unitFrom] || '';
  return col.unit || '';
}
function cellHtml(t, col, row, c) {
  const unit = unitFor(col, row);
  if (col.type === 'select') {
    const opts = (col.options || []).map(o => `<option value="${esc(o.value)}"${row[col.key] === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
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
    return `<div class="wf-numcell"><input class="wf-input wf-num${col.type === 'ref' ? ' wf-ref' : ''}" data-field="${col.key}" value="${esc(val)}" inputmode="decimal" aria-label="${esc(col.label)}">${unit ? `<span class="wf-unit">${esc(unit)}</span>` : ''}</div>${refBadge}`;
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
    <div class="wf-section-head"><h4>${esc(t.title)}</h4><span class="wf-tol-chip">${tolLabel}</span></div>
    <p class="wf-hint">${esc(t.hint)}</p>
    <div class="wf-table-wrap"><table class="wf-table">
      <thead><tr>${t.columns.map(col => `<th class="wf-col-${col.type}">${esc(col.label)}${col.unit && col.type !== 'status' && !col.unitFrom ? `<small>${esc(col.unit)}</small>` : ''}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map(r => rowHtml(t, r)).join('')}</tbody>
      ${footHtml(t)}
    </table></div>
    <button type="button" class="wf-add-row" data-add-row="${t.key}"><span class="material-symbols-rounded icon" aria-hidden="true">add</span>Zeile hinzufügen</button>
  </section>`;
}
function renderTables() {
  const tbls = TABLES[state.chk.modul] || [];
  el('wf-tables').innerHTML = tbls.map(tableHtml).join('');
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
    const input = e.target.closest('[data-field]');
    if (!input || !state) return;
    const tr = input.closest('tr'), section = input.closest('.wf-section');
    const t = TABLES[state.chk.modul].find(x => x.key === section.dataset.table);
    const row = findRow(t.key, tr.dataset.row);
    if (!row || input.tagName === 'SELECT') return;
    const col = t.columns.find(c => c.key === input.dataset.field);
    row[input.dataset.field] = col && (col.type === 'num' || col.type === 'ref') ? num(input.value) : input.value;
    touch();
    refreshRow(tr, t, row);
  });
  tablesEl.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-field]');
    if (!sel || !state) return;
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
  el('wf-zeitraum').addEventListener('input', (e) => { if (state) { state.chk.zeitraum = e.target.value; touch(); } });
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
  document.querySelectorAll('#wf-mode [data-mode]').forEach(b => b.addEventListener('click', () => { if (state) { setMode(b.dataset.mode); touch(); } }));
  el('wf-text').addEventListener('input', (e) => {
    if (!state) return;
    state.chk.freitext = e.target.value;
    touch();
    el('wf-text-status').textContent = 'Text wurde bearbeitet — Änderungen in der Tabelle fließen erst nach „Aus Tabelle neu erzeugen" ein.';
  });
  el('wf-text-regen').addEventListener('click', () => {
    if (!state) return;
    if (state.chk.freitext != null && !confirm('Bearbeiteten Text durch eine neu erzeugte Fassung ersetzen?')) return;
    state.chk.freitext = null;
    touch();
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
    if (e.key === 'Escape' && !el('warenfluss-overlay').hidden) { e.stopImmediatePropagation(); closeWarenfluss(); }
  }, true);
}

// Für die Liste im Termin: kurze Beschreibung einer Prüfung.
export function warenflussRowInfo(chk) {
  const s = summarizeWarenfluss(chk);
  return { titel: chk.titel || WF_MODULE[chk.modul].label, icon: WF_MODULE[chk.modul].icon, zeitraum: chk.zeitraum, summary: s };
}
export function warenflussTablesFor(modul) { return (TABLES[modul] || []).map(t => t.key); }
