// ---------- DBF: doppelte Feldnamen ----------
// DBF-Feldnamen sind auf 10 Zeichen begrenzt. Manche Exporte kürzen dabei
// mehrere lange Namen auf denselben (Thüringen "Antragsflächen Hauptnutzung":
// 8x "GEOWD_GEO_", 2x "GEOWD_FREE" …). Der übliche DBF-Leser behält je Name nur
// den LETZTEN Wert — die übrigen Spalten (darunter FLIK und Schlagnummer)
// gingen verloren. Hier werden die Spalten nach Position gelesen: der
// Feldname behält wie bisher den letzten Wert (nichts Bestehendes ändert
// sich), frühere gleichnamige Spalten kommen als "NAME~Spaltennummer" dazu.

// Feldbeschreibungen aus dem DBF-Kopf in Spaltenreihenfolge
export function dbfFelder(buf) {
  const b = new Uint8Array(buf);
  const felder = [];
  for (let o = 32; o + 32 <= b.length && b[o] !== 0x0d; o += 32) {
    let name = '';
    for (let i = 0; i < 11 && b[o + i]; i++) name += String.fromCharCode(b[o + i]);
    felder.push({ name: name.trim(), typ: String.fromCharCode(b[o + 11]), laenge: b[o + 16] });
  }
  return felder;
}
export const dbfHatDoppelteFelder = (felder) => new Set(felder.map(f => f.name)).size < felder.length;

function decoderFuer(encoding) {
  const e = String(encoding || '').trim().toLowerCase();
  const label = /utf-?8/.test(e) ? 'utf-8' : /1252|latin|8859|ansi/.test(e) || !e ? 'windows-1252' : e;
  try { return new TextDecoder(label); } catch { return new TextDecoder('windows-1252'); }
}
// Rohwerte (getrimmte Texte) je Datensatz und Spalte
export function dbfRohwerte(buf, encoding) {
  const view = new DataView(buf);
  const anzahl = view.getUint32(4, true), kopf = view.getUint16(8, true), satz = view.getUint16(10, true);
  const felder = dbfFelder(buf);
  const dec = decoderFuer(encoding);
  const b = new Uint8Array(buf);
  const out = [];
  for (let r = 0; r < anzahl; r++) {
    let p = kopf + r * satz + 1; // 1. Byte: Lösch-Kennzeichen
    if (p + satz - 1 > b.length) break;
    out.push(felder.map(f => { const s = dec.decode(b.subarray(p, p + f.laenge)).replace(/\0/g, '').trim(); p += f.laenge; return s; }));
  }
  return out;
}

// Ergänzt die Eigenschaften (vom üblichen DBF-Leser, gleiche Reihenfolge) um
// die verdeckten gleichnamigen Spalten und um bekannte Bedeutungen.
export function dbfDoppelteErgaenzen(properties, buf, encoding) {
  const felder = dbfFelder(buf);
  if (!dbfHatDoppelteFelder(felder)) return properties;
  const roh = dbfRohwerte(buf, encoding);
  const letzte = new Map();
  felder.forEach((f, i) => letzte.set(f.name, i));
  const thueringen = istThueringenHauptnutzung(felder);
  const schlagSpalte = thueringen ? thueringenSchlagSpalte(felder, roh) : -1;
  properties.forEach((props, r) => {
    const werte = roh[r];
    if (!props || !werte) return;
    felder.forEach((f, i) => {
      if (letzte.get(f.name) !== i && werte[i] !== '') props[`${f.name}~${i + 1}`] = werte[i];
    });
    if (thueringen) {
      const flik = werte.find(v => FLIK_RE.test(v));
      if (flik && !props.FLIK) props.FLIK = flik;
      if (schlagSpalte !== -1 && werte[schlagSpalte]) props.TH_SCHLAG = werte[schlagSpalte];
    }
  });
  return properties;
}

// Thüringen (VERONA "Antragsflächen Hauptnutzung"): an den GEOWD_-Feldern erkennbar.
// FLIK z.B. "DETHLIAL47303X03" (DE + Land + LI + Nutzungsart + Nummer).
export const FLIK_RE = /^DE[A-Z]{2}LI[A-Z0-9]{6,}$/;
export function istThueringenHauptnutzung(felder) {
  const namen = new Set(felder.map(f => f.name));
  return namen.has('GEOWD_ID') && namen.has('GEOWD_ANTJ');
}
// Spalte mit der Schlagnummer (z.B. "41.1", "19.1.1", "20*A"): Textspalte mit
// kurzen, mit einer Ziffer beginnenden Werten, die nicht überall gleich sind.
function thueringenSchlagSpalte(felder, roh) {
  let beste = -1;
  felder.forEach((f, i) => {
    if (f.typ !== 'C' || f.name !== 'GEOWD_GEO_') return;
    const werte = roh.map(r => r[i]).filter(Boolean);
    if (!werte.length || new Set(werte).size < 2) return;
    const passend = werte.filter(v => /^\d[0-9A-Za-z.*/-]{0,11}$/.test(v)).length;
    if (passend / werte.length >= 0.8 && beste === -1) beste = i;
  });
  return beste;
}
