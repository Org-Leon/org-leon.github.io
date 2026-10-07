// ---------- Nutzungsnachweis (FNN) auswerten ----------
// Ausdrucke des Flächen- und Nutzungsnachweises (PDF) enthalten die Kulturart
// im Klartext neben dem Nutzungscode, die Shape-Dateien oft nur den Code.
// Aus dem Vergleich beider lernt die App, was ein Code bedeutet:
//  1. Code und Klartext stehen im Ausdruck nebeneinander ("111150: Winterweichweizen",
//     "118 - Winter-Emmer/-Einkorn", Bayern: Code und Text in eigenen Spalten,
//     Text über mehrere Zeilen umbrochen) -> nur Codes übernehmen, die in den
//     Shapes vorkommen (so werden Schlagnummern o.ä. nicht als Code gelesen).
//  2. Shapes ganz ohne Kulturart (z.B. Thüringen bis 2025): Zeile des Ausdrucks
//     über FLIK (+ Größe bzw. Schlagnummer) einer Fläche zuordnen und deren
//     Kultur übernehmen.
// Reine Logik ohne Oberfläche; die PDF-Texte liefert main.js (pdf.js).

// Textstücke einer Seite ([{ x, y, s }]) zu Zeilen (gleiche Höhe ±2) zusammenfassen
export function fnnZeilen(seiten) {
  const zeilen = [];
  seiten.forEach((items, seite) => {
    const rows = [];
    items.forEach(it => {
      if (!it.s || !it.s.trim()) return;
      let r = rows.find(r => Math.abs(r.y - it.y) <= 2);
      if (!r) rows.push(r = { y: it.y, items: [] });
      r.items.push({ x: it.x, s: it.s.trim() });
    });
    rows.sort((a, b) => b.y - a.y).forEach(r => zeilen.push({ seite, y: r.y, items: r.items.sort((a, b) => a.x - b.x) }));
  });
  return zeilen;
}

const FLIK_RE = /^DE[A-Z]{2}LI[A-Z0-9]{6,}$/;
const FLIK_IRGENDWO = /DE[A-Z]{2}LI[A-Z0-9]{6,}/;
const HA_RE = /^(\d+,\d{4})(?:\s*ha)?$/;
// Code + Text in einem Stück: "190700: Winter…", "6,0554 118 - Winter…", "118 - Winter…"
const CODE_TEXT_RE = /(?:^|\s)(\d{2,6})\s*[:\-–]\s+(\S.*)$/;
const STOPP_RE = /zähljahr|^ha$|^\d|beantragung|vorgesehen|bearbeitung/i;

// Alle Code/Text-Paare einer Zeile (gedrehte Ausdrucke haben mehrere je Zeile)
function codeTexteInZeile(z) {
  const out = [];
  for (let i = 0; i < z.items.length; i++) {
    const it = z.items[i];
    const m = CODE_TEXT_RE.exec(it.s);
    if (m && /[A-Za-zÄÖÜäöü]/.test(m[2]) && !FLIK_IRGENDWO.test(m[2])) { out.push({ code: m[1], text: m[2], x: it.x, ab: it.x }); continue; }
    // Bayern: Code und Text als eigene Stücke nebeneinander. Code mindestens
    // 3-stellig und Text ohne FLIK, damit "Schlagnummer + Name" nicht als Code gilt.
    const n = z.items[i + 1];
    if (/^\d{3,6}$/.test(it.s) && n && /^[A-ZÄÖÜ(]/.test(n.s) && !FLIK_IRGENDWO.test(n.s) && n.x - it.x < 60) {
      out.push({ code: it.s, text: n.s, x: n.x, ab: it.x });
    }
  }
  return out;
}
// Umbrochenen Klartext aus den folgenden Zeilen (gleiche Spalte) anhängen
function fortsetzung(zeilen, i, x) {
  let text = '';
  for (let j = i + 1; j < Math.min(zeilen.length, i + 6); j++) {
    if (zeilen[j].seite !== zeilen[i].seite) break;
    if (codeTexteInZeile(zeilen[j]).length) break;
    const it = zeilen[j].items.find(t => Math.abs(t.x - x) <= 3);
    if (!it) continue;
    if (STOPP_RE.test(it.s) || FLIK_IRGENDWO.test(it.s)) break;
    text += (text.endsWith('-') || /^[/)]/.test(it.s) ? '' : ' ') + it.s;
  }
  return text;
}
const sauber = (t) => t.replace(/\s+/g, ' ').replace(/\s+([,)])/g, '$1').replace(/-\s+\//g, '-/').replace(/\/\s+-/g, '/-').trim();

// Wertet die Zeilen aus. codes: Set der Codes, die in den Shapes vorkommen (optional)
// Ergebnis: { codes: Map(code -> Klartext), zeilen: [{ flik, ha, code, text, nummern }] }
export function fnnAuswerten(zeilen, { codes = null } = {}) {
  const paare = new Map();
  const zeilenOut = [];
  zeilen.forEach((z, i) => {
    const alle = codeTexteInZeile(z);
    const flik = (z.items.find(t => FLIK_RE.test(t.s)) || {}).s || '';
    const haIt = z.items.find(t => HA_RE.test(t.s));
    const ha = haIt ? parseFloat(HA_RE.exec(haIt.s)[1].replace(',', '.')) : null;
    alle.forEach(ct => {
      let text = ct.text;
      // nur bei einem Paar je Zeile kann der Text in den Folgezeilen weiterlaufen
      const weiter = alle.length === 1 ? fortsetzung(zeilen, i, ct.x) : '';
      if (weiter) text += (text.endsWith('-') || /^[/)]/.test(weiter) ? '' : ' ') + weiter;
      text = sauber(text);
      const nummern = z.items.filter(t => t.x < ct.ab && /^\d+(\.\d+)*$/.test(t.s)).map(t => t.s);
      if (!codes || codes.has(ct.code)) {
        const bisher = paare.get(ct.code);
        if (!bisher || text.length > bisher.length) paare.set(ct.code, text);
      }
      // FLIK/Größe gehören nur eindeutig zur Kultur, wenn die Zeile genau ein Paar hat
      zeilenOut.push({ flik: alle.length === 1 ? flik : '', ha: alle.length === 1 ? ha : null, code: ct.code, text, nummern });
    });
  });
  return { codes: paare, zeilen: zeilenOut };
}

// Fläche ohne Kulturart einer Zeile des Ausdrucks zuordnen:
// gleiche FLIK; bei mehreren Treffern entscheidet die Größe, sonst die Schlagnummer.
// flaeche: { flik, ha, schlag }
export function fnnZeileFuer(flaeche, zeilen) {
  if (!flaeche.flik) return null;
  let kand = zeilen.filter(z => z.flik === flaeche.flik);
  if (kand.length > 1 && flaeche.ha) {
    const g = kand.filter(z => z.ha !== null && Math.abs(z.ha - flaeche.ha) <= 0.0001);
    if (g.length) kand = g;
  }
  if (kand.length > 1 && flaeche.schlag) {
    const s = kand.filter(z => z.nummern.includes(String(flaeche.schlag)));
    if (s.length) kand = s;
  }
  // mehrere Zeilen, aber alle mit derselben Kultur -> eindeutig genug
  if (kand.length > 1 && new Set(kand.map(z => z.code)).size === 1) kand = [kand[0]];
  return kand.length === 1 ? kand[0] : null;
}
