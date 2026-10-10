// Baut kleine Shapefiles (Polygone + DBF) für Tests und lädt sie als .zip in
// ein Datei-Feld der App. Alle Daten der Tests sind frei erfunden.

// felder: [[Name, Typ 'C'|'N', Länge, Nachkommastellen?]], zeilen: Werte je Feld
export function dbfBuffer(felder, zeilen) {
  const kopf = 32 + felder.length * 32 + 1, satz = 1 + felder.reduce((s, f) => s + f[2], 0);
  const b = Buffer.alloc(kopf + zeilen.length * satz + 1, 0);
  b[0] = 3; b.writeUInt32LE(zeilen.length, 4); b.writeUInt16LE(kopf, 8); b.writeUInt16LE(satz, 10);
  felder.forEach(([n, t, l, d = 0], i) => { const o = 32 + i * 32; b.write(n, o, 'latin1'); b.write(t, o + 11, 'latin1'); b[o + 16] = l; b[o + 17] = d; });
  b[kopf - 1] = 0x0d;
  zeilen.forEach((z, r) => {
    let o = kopf + r * satz; b[o++] = 0x20;
    z.forEach((v, i) => {
      const [, t, l] = felder[i];
      const s = t === 'N' ? String(v).padStart(l) : String(v).padEnd(l);
      b.write(s.slice(0, l), o, 'latin1'); o += l;
    });
  });
  b[b.length - 1] = 0x1a;
  return b;
}
// Rechtecke nebeneinander (WGS84), je Fläche ein Platz; breite in Grad
export function rechteck(platz, { x0 = 10.9, y0 = 50.9, breite = 0.003 } = {}) {
  const x = x0 + platz * 0.004, y = y0;
  return [[x, y], [x, y + 0.002], [x + breite, y + 0.002], [x + breite, y], [x, y]];
}
export function shpBuffers(ringe) {
  const recs = ringe.map((ring, i) => {
    const len = 48 + ring.length * 16; // Typ, Box, Teile, Punkte, Teil-Index + Punkte
    const r = Buffer.alloc(8 + len);
    r.writeInt32BE(i + 1, 0); r.writeInt32BE(len / 2, 4); r.writeInt32LE(5, 8);
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, k) => r.writeDoubleLE(v, 12 + k * 8));
    r.writeInt32LE(1, 44); r.writeInt32LE(ring.length, 48); r.writeInt32LE(0, 52);
    ring.forEach((p, k) => { r.writeDoubleLE(p[0], 56 + k * 16); r.writeDoubleLE(p[1], 64 + k * 16); });
    return r;
  });
  const kopf = (bytes) => { const h = Buffer.alloc(100); h.writeInt32BE(9994, 0); h.writeInt32BE(bytes / 2, 24); h.writeInt32LE(1000, 28); h.writeInt32LE(5, 32); return h; };
  const body = Buffer.concat(recs);
  const shx = Buffer.alloc(recs.length * 8);
  let off = 100;
  recs.forEach((r, i) => { shx.writeInt32BE(off / 2, i * 8); shx.writeInt32BE((r.length - 8) / 2, i * 8 + 4); off += r.length; });
  return { shp: Buffer.concat([kopf(100 + body.length), body]), shx: Buffer.concat([kopf(100 + shx.length), shx]) };
}
export const PRJ_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

// Lädt ein Shapefile (Name ohne Endung) als Zip in das Datei-Feld inputId.
// extra: weitere Dateien im Zip als { Dateiname: Text | { base64 } } (z.B. Antrags-XML, PDF)
export async function ladeShapeZip(page, inputId, zipName, ebene, felder, zeilen, ringe, extra = {}) {
  const { shp, shx } = shpBuffers(ringe);
  await page.evaluate(async ({ inputId, zipName, ebene, teile, extra }) => {
    const zip = new JSZip();
    Object.entries(teile).forEach(([ext, b64]) => zip.file(`${ebene}.${ext}`, b64, { base64: true }));
    Object.entries(extra).forEach(([name, inhalt]) => (inhalt && inhalt.base64 ? zip.file(name, inhalt.base64, { base64: true }) : zip.file(name, inhalt)));
    const blob = await zip.generateAsync({ type: 'blob' });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], zipName, { type: 'application/zip' }));
    const input = document.getElementById(inputId);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { inputId, zipName, ebene, extra, teile: { shp: shp.toString('base64'), shx: shx.toString('base64'), dbf: dbfBuffer(felder, zeilen).toString('base64'), prj: Buffer.from(PRJ_WGS84).toString('base64') } });
}
