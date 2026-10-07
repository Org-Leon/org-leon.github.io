import { test, expect } from '@playwright/test';

// Thüringen "Antragsflächen Hauptnutzung": die DBF kürzt mehrere Feldnamen auf
// denselben Namen (8x GEOWD_GEO_, 2x GEOWD_FREE …). Bisher kam nur der jeweils
// letzte Wert an, die FLIK ging verloren. Die Datei hier ist frei erfunden,
// gleicher Spaltenaufbau wie der VERONA-Export.
const FELDER = [
  ['GEOWD_LCHA', 'C', 20], ['GEOWD_FREE', 'C', 20], ['GEOWD_ID', 'N', 18], ['GEOWD_LCHA', 'C', 24], ['GEOWD_ANTJ', 'C', 4],
  ['GEOWD_GEO_', 'C', 16], ['GEOWD_FREE', 'C', 24], ['GEOWD_GEO_', 'C', 4], ['GEOWD_CREA', 'C', 20], ['GEOWD_AKT', 'C', 1],
  ['GEOWD_GEO_', 'C', 4], ['GEOWD_GEO_', 'C', 36], ['GEOWD_GEO_', 'C', 4], ['GEOWD_ALF_', 'C', 12], ['GEOWD_ALF_', 'C', 36],
  ['GEOWD_GEO_', 'C', 10], ['GEOWD_GEO_', 'C', 4], ['GEOWD_AST_', 'C', 36], ['GEOWD_GEO_', 'N', 18], ['GEOWD_CREA', 'C', 24]
];
// [GEOWD_ID, FLIK, Schlag, ha, Förderkürzel]
const FLAECHEN = [
  [9000001, 'DETHLIAL99999X01', '41.1', 3.25, 'DZ,ÖL2AL,ÖR2'],
  [9000002, 'DETHLIFH99999X02', '41.1', 0.0635, 'DZ'],
  [9000003, 'DETHLIGL99999Y03', '7', 1.5, 'DZ,ÖL2GL']
];
const zeile = ([id, flik, schlag, ha, foerder]) => ['PORTIA_000000', flik, id, '2025-04-25T10:00:00Z', '2025', 'VERONA_FNN_TF_HN', foerder, '', 'PORTIA_000000', 'A',
  '', `0000000${id}-uuid`, '', 'VERONA_FNNHN', `alf-${id}`, schlag, '', 'ast-0000', ha.toFixed(4), '2025-04-25T09:00:00Z'];

function dbf() {
  const kopf = 32 + FELDER.length * 32 + 1, satz = 1 + FELDER.reduce((s, f) => s + f[2], 0);
  const b = Buffer.alloc(kopf + FLAECHEN.length * satz + 1, 0);
  b[0] = 3; b.writeUInt32LE(FLAECHEN.length, 4); b.writeUInt16LE(kopf, 8); b.writeUInt16LE(satz, 10);
  FELDER.forEach(([n, t, l], i) => { const o = 32 + i * 32; b.write(n, o, 'latin1'); b.write(t, o + 11, 'latin1'); b[o + 16] = l; b[o + 17] = t === 'N' && i === 18 ? 4 : 0; });
  b[kopf - 1] = 0x0d;
  FLAECHEN.forEach((f, r) => {
    let o = kopf + r * satz; b[o++] = 0x20;
    zeile(f).forEach((v, i) => { const l = FELDER[i][2]; const s = FELDER[i][1] === 'N' ? String(v).padStart(l) : String(v).padEnd(l); b.write(s.slice(0, l), o, 'latin1'); o += l; });
  });
  b[b.length - 1] = 0x1a;
  return b;
}
function shp() {
  const ringe = FLAECHEN.map((_, i) => { const x = 10.90 + i * 0.004, y = 50.90; return [[x, y], [x, y + 0.002], [x + 0.003, y + 0.002], [x + 0.003, y], [x, y]]; });
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
const PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

async function ladeZip(page) {
  const { shp: s, shx } = shp();
  const name = 'Antragsflächen Hauptnutzung_POLYGONE';
  await page.evaluate(async ({ name, teile }) => {
    const zip = new JSZip();
    Object.entries(teile).forEach(([ext, b64]) => zip.file(`${name}.${ext}`, b64, { base64: true }));
    const blob = await zip.generateAsync({ type: 'blob' });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], '2025_Testbetrieb_Thueringen_ShapeDateien.zip', { type: 'application/zip' }));
    const input = document.getElementById('file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name, teile: { shp: s.toString('base64'), shx: shx.toString('base64'), dbf: dbf().toString('base64'), prj: Buffer.from(PRJ).toString('base64') } });
}

test.describe('Thüringen: doppelte DBF-Feldnamen', () => {
  test('FLIK kommt aus der verdeckten Spalte; Größe und Nummer wie bisher', async ({ page }) => {
    await page.goto('/');
    await ladeZip(page);
    const rows = page.locator('#feature-table-body tr');
    await expect(rows).toHaveCount(3);
    const spalte = async (titel) => {
      const heads = await page.locator('#feature-table thead th').allInnerTexts();
      const i = heads.findIndex(h => h.trim() === titel);
      return rows.evaluateAll((trs, i) => trs.map(tr => tr.children[i].textContent.trim()), i);
    };
    expect((await spalte('Flächenidentifikator')).sort()).toEqual(['DETHLIAL99999X01', 'DETHLIFH99999X02', 'DETHLIGL99999Y03']);
    // Flächennummer bleibt die (eindeutige) GEOWD_ID, Größe die ha-Spalte
    expect((await spalte('Schlagnr. / Flächennr.')).sort()).toEqual(['9000001', '9000002', '9000003']);
    expect((await spalte('Größe')).join(' ')).toContain('3,25');

    // Suche über die FLIK
    await page.locator('#topbar-search').fill('DETHLIGL99999Y03');
    await expect(page.locator('#topbar-search-results')).toContainText('DETHLIGL99999Y03');
  });

  test('Modul: verdeckte Spalten als NAME~Spalte, Schlagnummer und FLIK', async ({ page }) => {
    await page.goto('/');
    const props = await page.evaluate(async (b64) => {
      const m = await import('/src/dbf-felder.js');
      const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
      const props = [{ GEOWD_FREE: 'DZ,ÖL2AL,ÖR2', GEOWD_GEO_: 3.25 }, {}, {}];
      return m.dbfDoppelteErgaenzen(props, buf, 'windows-1252');
    }, dbf().toString('base64'));
    expect(props[0].FLIK).toBe('DETHLIAL99999X01');
    expect(props[0].TH_SCHLAG).toBe('41.1');
    expect(props[0]['GEOWD_FREE~2']).toBe('DETHLIAL99999X01');
    expect(props[0].GEOWD_FREE).toBe('DZ,ÖL2AL,ÖR2'); // letzter Wert bleibt wie bisher
    expect(props[1].TH_SCHLAG).toBe('41.1');
    expect(props[2].FLIK).toBe('DETHLIGL99999Y03');
  });
});
