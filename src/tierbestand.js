// ---------- Tierbestand (HIT-Bestandsregister) ----------
// Liest einen Auszug "Bestandsregister" aus der HI-Tier-Datenbank (PDF) und
// rechnet daraus Bestand, Zu- und Abgänge, Altersklassen, Großvieheinheiten
// und den Stickstoffanfall. Reine Logik ohne Oberfläche (die steckt in
// main.js, Abschnitt "Tierbestand").
//
// Datenschutz: Aus dem Auszug werden nur die Tierzeilen und der Zeitraum
// übernommen. Kopfdaten (Name, Anschrift, Telefon, Betriebsnummer des
// Betriebs) werden nicht gelesen und nicht gespeichert.
//
// Ein Tier: { ohrmarke, geb, sex: 'M'|'W', rasse, mutter, zugang: { datum, art, betrieb },
//             abgang: { datum, art, betrieb } | null, land, gve }   (Datum als JJJJ-MM-TT)

export const TB_ZUGANG_ARTEN = {
  GE: 'Geburt im Betrieb', ZU: 'Zugang (Zukauf / Übernahme)', ER: 'Ersterfassung',
  EU: 'EU-Einfuhr', IM: 'Importmarkierung', UN: 'unbekannt'
};
export const TB_ABGANG_ARTEN = {
  AB: 'Abgang (Verkauf / Abgabe)', SC: 'Schlachtung', HS: 'Hausschlachtung', VE: 'Verendung',
  TO: 'Tod', AU: 'Ausfuhr', WA: 'widersprüchliche Angaben'
};
// Altersklassen (Rinder). gv: Großvieheinheiten-Schlüssel "Umwelt" (0,3 / 0,6 /
// 1,0), wie im HIT-Auszug. n: Stickstoffanfall in kg je Tier und Jahr,
// abgeleitet aus den Höchsttierzahlen je Hektar für 170 kg N (Anhang IV der
// VO (EG) 889/2008: 170 ÷ Tiere je ha) — Orientierungswerte.
export const TB_KLASSEN = [
  { key: 'kalb', label: 'Kälber bis 6 Monate', gv: 0.3, n: 34 },
  { key: 'jung', label: 'Jungrinder 6–12 Monate', gv: 0.6, n: 34 },
  { key: 'm1', label: 'Männliche Rinder 1–2 Jahre', gv: 0.6, n: 51.5 },
  { key: 'w1', label: 'Weibliche Rinder 1–2 Jahre', gv: 0.6, n: 51.5 },
  { key: 'm2', label: 'Männliche Rinder ab 2 Jahre', gv: 1.0, n: 85 },
  { key: 'faerse', label: 'Färsen ab 2 Jahre (ohne Kalbung)', gv: 1.0, n: 68 },
  { key: 'kuh', label: 'Kühe (mit Kalbung)', gv: 1.0, n: 68, nMilch: 85 }
];
export const TB_N_GRENZE = 170; // kg N je ha und Jahr (VO (EU) 2018/848)

const iso = (d, m, y) => `${y}-${m}-${d}`;
const toIso = (de) => { const [d, m, y] = de.split('.'); return iso(d, m, y); };
const day = (isoDate) => { const [y, m, d] = isoDate.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const addMonths = (isoDate, n) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, d));
  return dt.toISOString().slice(0, 10);
};
export const tbFmtDate = (isoDate) => (isoDate ? isoDate.split('-').reverse().join('.') : '');

const D = '(\\d{2}\\.\\d{2}\\.\\d{4})';
// Ohrmarke · Geburtsdatum · Geschlecht · Rasse · Mutter · Zugang (Datum Art
// [Vorbesitzer]) · [Abgang (Datum Art [Übernehmer])] · [Bemerkung] · GVE
const ROW = new RegExp('^([A-Z]{2} ?[\\dA-Z ]*?\\d)\\s+' + D + '\\s+([MW])\\s+(\\S+)\\s+(.*?)\\s*' + D + '\\s+([A-Z]{2})\\b\\s*([\\d ]*?)\\s*(?:' + D + '\\s+([A-Z]{2})\\b\\s*([\\d ]*?))?\\s*(\\D*?)\\s*(\\d+,\\d{3})$');

export function parseHitRow(line) {
  const m = ROW.exec(String(line).replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  return {
    ohrmarke: clean(m[1]), geb: toIso(m[2]), sex: m[3], rasse: m[4], mutter: clean(m[5]),
    zugang: { datum: toIso(m[6]), art: m[7], betrieb: clean(m[8]) },
    abgang: m[9] ? { datum: toIso(m[9]), art: m[10], betrieb: clean(m[11]) } : null,
    land: clean(m[12]), gve: parseFloat(m[13].replace(',', '.'))
  };
}
// Zeilen eines Auszugs -> { von, bis, tiere, kontrolle }. Kopf-/Fußzeilen und
// alles, was keine Tierzeile ist, wird übersprungen.
export function parseHitLines(lines) {
  const out = { von: null, bis: null, tiere: [], kontrolle: { datensaetze: null, gve: null, endbestand: null } };
  const seen = new Set();
  lines.forEach(raw => {
    const line = String(raw).replace(/\s+/g, ' ').trim();
    if (!line) return;
    let m;
    if (!out.von && (m = new RegExp('von ' + D + ' bis ' + D).exec(line))) { out.von = toIso(m[1]); out.bis = toIso(m[2]); return; }
    if ((m = /(\d+) Datensätze/.exec(line))) out.kontrolle.datensaetze = Number(m[1]);
    if ((m = /GVE betragen:?\s*([\d.]+,\d+)/.exec(line))) out.kontrolle.gve = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    if ((m = /befanden sich (\d+) Tiere/.exec(line))) out.kontrolle.endbestand = Number(m[1]);
    const t = parseHitRow(line);
    if (t && !seen.has(t.ohrmarke + '|' + t.zugang.datum)) { seen.add(t.ohrmarke + '|' + t.zugang.datum); out.tiere.push(t); }
  });
  return out;
}
// PDF -> Textzeilen (Textstücke gleicher Höhe von links nach rechts) -> parseHitLines.
export async function parseHitPdf(arrayBuffer, pdfjsLib) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const rows = [];
    content.items.forEach(it => {
      if (!it.str || !it.str.trim()) return;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, str: it.str });
    });
    rows.sort((a, b) => b.y - a.y).forEach(r => lines.push(r.items.sort((a, b) => a.x - b.x).map(i => i.str).join(' ')));
  }
  return parseHitLines(lines);
}

// Klasse eines Tiers an einem Tag. gekalbt = Ohrmarke kommt im Auszug als Mutter vor.
function klasseAm(t, isoDate, gekalbt) {
  if (isoDate < addMonths(t.geb, 6)) return 'kalb';
  if (isoDate < addMonths(t.geb, 12)) return 'jung';
  if (isoDate < addMonths(t.geb, 24)) return t.sex === 'M' ? 'm1' : 'w1';
  if (t.sex === 'M') return 'm2';
  return gekalbt ? 'kuh' : 'faerse';
}
export function tbAlterText(geb, stichtag) {
  const [y1, m1, d1] = geb.split('-').map(Number), [y2, m2, d2] = stichtag.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) months = 0;
  return months < 24 ? `${months} Mon.` : `${Math.floor(months / 12)} J.`;
}

// Auswertung. opts: { kuhNutzung: 'mutterkuh' | 'milch', lfHa }
export function computeTierbestand(data, opts = {}) {
  const { von, bis, tiere } = data;
  const milch = opts.kuhNutzung === 'milch';
  const nFaktor = (k) => (k.key === 'kuh' && milch ? k.nMilch : k.n);
  const muetter = new Set(tiere.map(t => t.mutter).filter(Boolean));
  const tage = day(bis) - day(von) + 1;
  const anwesendAmEnde = (t) => !t.abgang || t.abgang.datum > bis;

  const zug = tiere.filter(t => t.zugang.datum >= von && t.zugang.datum <= bis);
  const abg = tiere.filter(t => t.abgang && t.abgang.datum >= von && t.abgang.datum <= bis);
  const byArt = (list, get, labels) => {
    const map = new Map();
    list.forEach(t => { const a = get(t); map.set(a, (map.get(a) || 0) + 1); });
    return [...map.entries()].map(([art, n]) => ({ art, label: labels[art] || art, n })).sort((a, b) => b.n - a.n);
  };
  const uebernehmer = new Map();
  abg.filter(t => t.abgang.betrieb).forEach(t => uebernehmer.set(t.abgang.betrieb, (uebernehmer.get(t.abgang.betrieb) || 0) + 1));
  const vorbesitzer = new Map();
  zug.filter(t => t.zugang.betrieb).forEach(t => vorbesitzer.set(t.zugang.betrieb, (vorbesitzer.get(t.zugang.betrieb) || 0) + 1));

  // Monate des Zeitraums mit Zu-/Abgängen
  const monate = [];
  for (let m = von.slice(0, 7); m <= bis.slice(0, 7); m = addMonths(m + '-01', 1).slice(0, 7)) {
    monate.push({ monat: m, zu: zug.filter(t => t.zugang.datum.startsWith(m)).length, ab: abg.filter(t => t.abgang.datum.startsWith(m)).length });
  }

  // Bestand am Stichtag nach Klasse
  const klassen = TB_KLASSEN.map(k => ({ ...k, nFaktor: nFaktor(k), m: 0, w: 0, tage: 0 }));
  const kl = Object.fromEntries(klassen.map(k => [k.key, k]));
  const ende = tiere.filter(anwesendAmEnde);
  ende.forEach(t => { kl[klasseAm(t, bis, muetter.has(t.ohrmarke))][t.sex === 'M' ? 'm' : 'w']++; });

  // Durchschnittsbestand: Anwesenheitstage je Klasse (Abgangstag zählt nicht, wie in HIT)
  tiere.forEach(t => {
    let a = t.zugang.datum > von ? t.zugang.datum : von;
    const end = t.abgang && t.abgang.datum <= bis ? t.abgang.datum : addDays(bis, 1);
    const gekalbt = muetter.has(t.ohrmarke);
    const grenzen = [6, 12, 24].map(n => addMonths(t.geb, n)).filter(g => g > a && g < end);
    [...grenzen, end].forEach(b => { kl[klasseAm(t, a, gekalbt)].tage += Math.max(0, day(b) - day(a)); a = b; });
  });
  klassen.forEach(k => { k.schnitt = k.tage / tage; k.gvSchnitt = k.schnitt * k.gv; k.nJahr = k.schnitt * k.nFaktor; k.anzahl = k.m + k.w; k.gvStichtag = k.anzahl * k.gv; });

  const sum = (f) => klassen.reduce((s, k) => s + f(k), 0);
  const gvDatei = tiere.reduce((s, t) => s + (t.gve || 0), 0);
  const lfHa = Number(opts.lfHa) > 0 ? Number(opts.lfHa) : null;
  const nJahr = sum(k => k.nJahr);
  const endbestand = ende.length;
  const anfang = tiere.filter(t => t.zugang.datum < von).length;
  const verluste = abg.filter(t => t.abgang.art === 'VE' || t.abgang.art === 'TO').length;
  const schnitt = sum(k => k.schnitt);
  return {
    von, bis, tage, anzahl: tiere.length, anfang, endbestand,
    zugaenge: { n: zug.length, arten: byArt(zug, t => t.zugang.art, TB_ZUGANG_ARTEN), geburten: zug.filter(t => t.zugang.art === 'GE').length, vorbesitzer: [...vorbesitzer.entries()].sort((a, b) => b[1] - a[1]) },
    abgaenge: { n: abg.length, arten: byArt(abg, t => t.abgang.art, TB_ABGANG_ARTEN), verluste, uebernehmer: [...uebernehmer.entries()].sort((a, b) => b[1] - a[1]) },
    bilanzOk: anfang + zug.length - abg.length === endbestand,
    monate, klassen,
    schnitt, verlustrate: schnitt ? verluste / schnitt * 100 : null,
    gvStichtag: sum(k => k.gvStichtag), gvSchnitt: sum(k => k.gvSchnitt), gvDatei,
    lfHa, nJahr, nJeHa: lfHa ? nJahr / lfHa : null, nAuslastung: lfHa ? nJahr / lfHa / TB_N_GRENZE * 100 : null,
    nMaxHa: nJahr / TB_N_GRENZE, gvJeHa: lfHa ? sum(k => k.gvSchnitt) / lfHa : null,
    kontrolle: data.kontrolle || {}
  };
}
function addDays(isoDate, n) {
  return new Date((day(isoDate) + n) * 86400000).toISOString().slice(0, 10);
}
// Status eines Tiers für die Liste
export function tbStatus(t, von, bis) {
  if (t.abgang && t.abgang.datum <= bis) return 'abgang';
  return t.zugang.datum >= von ? 'zugang' : 'bestand';
}
