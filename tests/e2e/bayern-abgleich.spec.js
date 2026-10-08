import { test, expect } from '@playwright/test';
import { dbfBuffer, rechteck, shpBuffers, PRJ_WGS84 } from './shapefile-helper.js';

// Bayern (iBALIS-Export): Feldstueck + Nutzung (Schläge, je mit eigener
// Geometrie) + Gewaesserrandstreifen. Die Schlagliste führt die SCHLÄGE, vorn
// in der Bezeichnung steht die Feldstücknummer. Alle Daten frei erfunden.

const FS_FELDER = [['Betriebsnr', 'N', 12], ['FID', 'C', 20], ['FSNr', 'N', 6], ['Name', 'C', 30], ['Jahr', 'N', 4], ['LFlaeche', 'N', 12, 4]];
const NU_FELDER = [['Betriebsnr', 'N', 12], ['FID', 'C', 20], ['FSNr', 'N', 6], ['Schlag', 'C', 4], ['Flaeche', 'N', 12, 4], ['Nutzung', 'C', 6]];
const GW_FELDER = [['Betriebsnr', 'N', 12], ['FID', 'C', 20], ['FSNr', 'N', 6], ['Nummer', 'N', 4], ['Flaeche', 'N', 12, 4]];
const FLIK = (n) => 'DEBYLI99999900' + String(n).padStart(2, '0');
// Feldstücke 2026: [FSNr, Name, ha]
const FS = [[1, 'Hangacker', 2.0], [2, 'Bachwiese', 1.2], [3, 'Neufeld', 0.8]];
// Schläge 2026: [FSNr, Schlag, ha, Code, Platz]
const NU = [[1, '1', 2.0, '115', 0], [2, '1', 0.02, '424', 1], [2, '2', 1.18, '451', 2], [3, '1', 0.8, '422', 3]];
// Vorjahr 2025: anderes Feldstück 6 (früher hätte die Listenzeile "00006" darauf gezeigt)
const FS25 = [[1, 'Hangacker', 2.0], [6, 'Andersacker', 0.5]];
const NU25 = [[1, '1', 2.0, '115', 0], [6, '1', 0.5, '422', 5]];

function ebene(name, felder, zeilen, ringe) {
  const { shp, shx } = shpBuffers(ringe);
  return {
    [name + '.shp']: { base64: shp.toString('base64') }, [name + '.shx']: { base64: shx.toString('base64') },
    [name + '.dbf']: { base64: dbfBuffer(felder, zeilen).toString('base64') }, [name + '.prj']: PRJ_WGS84
  };
}
function bayernZip(jahr, fs, nu, gw = []) {
  return {
    ...ebene('Feldstueck', FS_FELDER, fs.map(([n, name, ha]) => [4711, FLIK(n), n, name, jahr, ha.toFixed(4)]), fs.map((_, i) => rechteck(i + 10))),
    ...ebene('Nutzung', NU_FELDER, nu.map(([n, s, ha, c]) => [4711, FLIK(n), n, s, ha.toFixed(4), c]), nu.map(x => rechteck(x[4]))),
    ...(gw.length ? ebene('Gewaesserrandstreifen', GW_FELDER, gw.map(([n, nr, ha]) => [4711, FLIK(n), n, nr, ha.toFixed(4)]), gw.map(x => rechteck(x[3]))) : {})
  };
}
async function ladeZip(page, inputId, zipName, dateien) {
  await page.evaluate(async ({ inputId, zipName, dateien }) => {
    const zip = new JSZip();
    Object.entries(dateien).forEach(([name, inhalt]) => (inhalt && inhalt.base64 ? zip.file(name, inhalt.base64, { base64: true }) : zip.file(name, inhalt)));
    const dt = new DataTransfer();
    dt.items.add(new File([await zip.generateAsync({ type: 'blob' })], zipName, { type: 'application/zip' }));
    const input = document.getElementById(inputId);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { inputId, zipName, dateien });
}
const HEADER = ['Kundennummer', 'PK Feld', 'PK Kultur', 'Schlagnummer', 'Bezeichnung', 'Flächenidentifikationsnummer', 'Kategorie', 'Kultur', 'Sorte', 'Zusatz', 'ha', 'Land', 'Bundesland', 'Zugang Fläche', 'Abgang Fläche', 'Status Feldstück', 'Fläche besichtigt im Jahr', 'Import Information'];
const OEKO = 'Ökologische Erzeugnisse';
const zeile = (pk, nr, bez, ha, kultur = '', zugang = '01.07.2020') => ['4711', 'feld-' + pk, 'kultur-' + pk, nr, bez, '', '', kultur, '', '', ha, 'Deutschland', 'Bayern', zugang, '', OEKO, '2025', 'Not updated'];
// Schlagnummer = interne Zählung, Feldstücknummer vorn in der Bezeichnung, keine FLIK
const LISTE = [
  zeile('a', '00001', '1 Hangacker', 2.0),
  zeile('b', '00002', '2 Bachwiese', 1.18),
  zeile('c', '00003', '2 Bachwiese', 0.02),
  zeile('d', '00004', '3 Neufeld', 0.75),
  zeile('e', '00005', '3 Neufeld_Teilstück 2025', 0.05, '', '01.03.2025'),
  zeile('f', '00006', '9 Altacker', 0.5)
];
async function listeFile(page) {
  const b64 = await page.evaluate(({ HEADER, rows }) => {
    const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Felder & Kulturen DE');
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  }, { HEADER, rows: LISTE });
  return { name: 'Felder_&_Kulturen_DE.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b64, 'base64') };
}
async function streamToBuffer(stream) { const c = []; for await (const x of stream) c.push(x); return Buffer.concat(c); }

test.describe('Bayern: Feldstück + Nutzung + Gewässerrandstreifen', () => {
  test('Karte/Übersicht: je Schlag eine Fläche mit Schlaggröße, Gewässerrandstreifen zählt nicht mit', async ({ page }) => {
    await page.goto('/');
    await ladeZip(page, 'file-input', 'FlaechenAbfrage.zip', bayernZip(2026, FS, NU, [[2, 1, 0.02, 1]]));
    await page.locator('.segment-btn[data-view="uebersicht"]').click();
    const tabelle = page.locator('#ue-table tbody tr');
    await expect(tabelle).toHaveCount(4);
    // Feldstück 2 mit zwei Schlägen: 2/1 (Randstreifen) und 2/2 — je mit eigener Größe
    await expect(page.locator('#ue-table tbody tr', { hasText: '2/2' })).toContainText('1,18');
    await expect(page.locator('#ue-table tbody tr', { hasText: '2/1' })).toContainText('0,02');
    await expect(page.locator('#ue-table tbody tr', { hasText: 'Bachwiese' })).toHaveCount(2);
    await expect(page.locator('#ue-notes')).toContainText('Zusatzebenen (Teilflächen, Gewässerrandstreifen)');
    // Summe = Schläge (4,00 ha), nicht Feldstück-Größe eines zufälligen Schlags
    await expect(page.locator('#ue-kpis')).toContainText('4,00');
  });

  test('Schlagliste: Zuordnung über Feldstücknummer + Schlaggröße, Teilstück erkannt, nichts Falsches auf der Karte', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await page.locator('.segment-btn[data-view="compare"]').click();
    await ladeZip(page, 'compare-file-add', 'FlaechenAbfrage_2025.zip', bayernZip(2025, FS25, NU25));
    await expect(page.locator('.cy-row')).toHaveCount(1);
    await ladeZip(page, 'compare-file-add', 'FlaechenAbfrage_2026.zip', bayernZip(2026, FS, NU, [[2, 1, 0.02, 1]]));
    await expect(page.locator('.cy-row')).toHaveCount(2);
    await expect(page.locator('.cy-row').nth(1)).toContainText('4 Flächen · 4,00 ha');
    await page.setInputFiles('#sl-file', await listeFile(page));
    await page.locator('#sl-kultur-uebernehmen').uncheck();
    await page.locator('#sl-stichtag').fill('2026-10-05');
    await page.locator('#sl-stichtag').dispatchEvent('change');

    // automatisch: 1 Hangacker, beide Schläge von 2 Bachwiese (über die Größe)
    await page.locator('.sl-sec.is-ok > summary').click();
    await expect(page.locator('.sl-sec.is-ok tbody tr')).toHaveCount(3);
    await expect(page.locator('.sl-sec.is-ok tr', { hasText: '1,18' })).toContainText('2/2');
    await expect(page.locator('.sl-sec.is-ok tr', { hasText: '0,02 ha' }).first()).toContainText('2/1');
    // 3 Neufeld (0,75) + Teilstück (0,05) = Fläche 3 (0,80): Teilstück ist kein Abgang
    await expect(page.locator('.sl-sec.is-warn .sl-item').first()).toContainText('3 Neufeld');
    const unv = page.locator('.sl-sec.is-nachantrag');
    await expect(unv.locator('summary')).toContainText('(1)');
    await expect(unv).toContainText('Teilstück von 3 Neufeld');
    // 9 Altacker: nicht in den Shapes, auch nicht auf der Karte (früher: Feldstück 6 aus 2025)
    const fehlt = page.locator('.sl-sec.is-fehlt .sl-item');
    await expect(fehlt).toHaveCount(1);
    await expect(fehlt).toContainText('9 Altacker');
    await expect(page.locator('#map path.sl-fehlt')).toHaveCount(0);
    await expect(fehlt.locator('[data-sl-focus]')).toHaveCount(0);

    // Hauptzeile bestätigen -> Export: 3 Neufeld bekommt 0,80 − 0,05 = 0,75 ha, Teilstück bleibt
    await page.locator('.sl-sec.is-warn [data-sl-ok]').first().click();
    await fehlt.locator('[data-sl-gleich]').click();
    await expect(page.locator('.sl-sec.is-nachantrag summary')).toContainText('(2)');
    await expect(page.locator('.sl-sec.is-nachantrag')).toContainText('unverändert gelassen');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#sl-export2').click()]);
    const b64 = (await streamToBuffer(await download.createReadStream())).toString('base64');
    const rows = await page.evaluate((b64) => { const wb = XLSX.read(b64, { type: 'base64' }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1); }, b64);
    const byPk = Object.fromEntries(rows.map(r => [r[1], r]));
    // [ha, Abgang, Import Information]
    expect([byPk['feld-d'][10], byPk['feld-d'][14]]).toEqual([0.75, '']);
    expect([byPk['feld-e'][10], byPk['feld-e'][14]]).toEqual([0.05, '']);
    expect([byPk['feld-f'][10], byPk['feld-f'][14], byPk['feld-f'][17]]).toEqual([0.5, '', 'Not updated']);
  });

  test('Zeile ohne Fläche mit einer anderen zusammenfügen: Abgang mit Verweis, lösbar', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await page.locator('.segment-btn[data-view="compare"]').click();
    await ladeZip(page, 'compare-file-add', 'FlaechenAbfrage_2026.zip', bayernZip(2026, FS, NU));
    await page.setInputFiles('#sl-file', await listeFile(page));
    await page.locator('#sl-kultur-uebernehmen').uncheck();
    const fehlt = page.locator('.sl-sec.is-fehlt .sl-item', { hasText: '9 Altacker' });
    await fehlt.locator('[data-sl-zusammen-mit]').selectOption({ label: '1 Hangacker · 2,00 ha' });
    await expect(fehlt).toHaveClass(/is-done/);
    await expect(fehlt).toContainText('Zusammengefügt mit 1 Hangacker');
    await page.locator('.sl-sec.is-fehlt > summary').click(); // erledigt -> zugeklappt
    await fehlt.locator('[data-sl-zusammen-weg]').click();
    await expect(fehlt).not.toHaveClass(/is-done/);
    await expect(fehlt.locator('[data-sl-abgang]')).not.toBeChecked();
  });

  test('Kulturen: Suchfeld statt Liste, erst „Passt“ hakt ab, nur Katalog-Kulturen', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await page.goto('/');
    await page.evaluate(() => { localStorage.removeItem('feldfolio-kultur-zuordnung'); });
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await page.locator('.segment-btn[data-view="compare"]').click();
    // Schlag 3/1 mit unbekanntem Nutzungscode 998 -> Kultur muss zugeordnet werden
    await ladeZip(page, 'compare-file-add', 'FlaechenAbfrage_2026.zip', bayernZip(2026, FS, NU.map(n => (n[0] === 3 ? [3, '1', 0.8, '998', 3] : n))));
    await page.setInputFiles('#sl-file', await listeFile(page));
    const anzahl = await page.locator('.sl-sec.is-kultur .sl-kitem:not(.is-done)').count();
    expect(anzahl).toBeGreaterThan(0);
    const zeile = page.locator('.sl-sec.is-kultur .sl-kitem').filter({ has: page.locator('[data-sl-kultur="998"]') });
    await expect(zeile).not.toHaveClass(/is-done/);
    const feld = zeile.locator('[data-sl-kultur]');
    await expect(feld).toHaveAttribute('list', 'sl-katalog');
    expect(await page.locator('#sl-katalog option').count()).toBeGreaterThan(100);
    // Eingabe außerhalb des Katalogs: Hinweis, nichts übernommen
    await feld.fill('Gibt es nicht');
    await zeile.locator('[data-sl-kultur-ok]').click();
    await expect(zeile.locator('.sl-kultur-fehler')).toBeVisible();
    await expect(zeile).not.toHaveClass(/is-done/);
    // Auswahl allein hakt noch nicht ab …
    await feld.fill('Grünbrache');
    await feld.dispatchEvent('change');
    await expect(zeile).not.toHaveClass(/is-done/);
    await expect(zeile.locator('.sl-kultur-fehler')).toBeHidden();
    // … erst „Passt“
    await zeile.locator('[data-sl-kultur-ok]').click();
    await expect(zeile).toHaveClass(/is-done/);
    await expect(zeile.locator('[data-sl-kultur]')).toHaveValue('Grünbrache');
    await expect(page.locator('.sl-sec.is-kultur .sl-kitem:not(.is-done)')).toHaveCount(anzahl - 1);
  });

  // Feldstück 4 (3,20 ha, ein Schlag) wird 2026 in drei Schläge geteilt. Die Liste
  // führt "4 Langfeld" (3,00 ha, Bio seit 2020) und ein Teilstück "…_Abdrift 2025" (0,20 ha).
  test('Teilung: Zeile geht in zwei Schläge auf — Vorschlag, vom Kontrolleur bestätigt, neue Zeile mit gleichem Umstellungsdatum', async ({ page }) => {
    page.on('dialog', d => d.accept());
    const KONV = 'Nichtökologische Erzeugnisse (aus dem 1. Umstellungsjahr)';
    await page.goto('/');
    await page.evaluate(() => { localStorage.removeItem('feldfolio-sl-status'); });
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await page.locator('.segment-btn[data-view="compare"]').click();
    await ladeZip(page, 'compare-file-add', 'FlaechenAbfrage_2025.zip', bayernZip(2025, [[4, 'Langfeld', 3.2]], [[4, '1', 3.2, '115', 6]]));
    await expect(page.locator('.cy-row')).toHaveCount(1);
    await ladeZip(page, 'compare-file-add', 'FlaechenAbfrage_2026.zip', bayernZip(2026, [[4, 'Langfeld', 3.2]],
      [[4, '1', 2.0, '115', 6], [4, '2', 1.0, '422', 7], [4, '3', 0.2, '421', 8]]));
    await expect(page.locator('.cy-row')).toHaveCount(2);
    const rows = [zeile('m', '00007', '4 Langfeld', 3.0), ['4711', 'feld-t', 'kultur-t', '00008', '4 Langfeld_Abdrift 2025', '', '', '', '', '', 0.2, 'Deutschland', 'Bayern', '19.05.2025', '', KONV, '2025', 'Not updated']];
    const b64 = await page.evaluate(({ HEADER, rows }) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), 'Felder & Kulturen DE');
      return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    }, { HEADER, rows });
    await page.setInputFiles('#sl-file', { name: 'Liste.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b64, 'base64') });
    await page.locator('#sl-kultur-uebernehmen').uncheck();
    await page.locator('#sl-stichtag').fill('2026-10-05');
    await page.locator('#sl-stichtag').dispatchEvent('change');

    // Teilstück-Zeile passt allein zu 4/3; die Hauptzeile ist ein Zweifelsfall mit Vorschlag "Geteilt?"
    await page.locator('.sl-sec.is-ok > summary').click();
    await expect(page.locator('.sl-sec.is-ok tbody tr')).toHaveCount(1);
    await expect(page.locator('.sl-sec.is-ok tbody tr')).toContainText('4/3');
    const haupt = page.locator('.sl-sec.is-warn .sl-item', { hasText: '4 Langfeld' });
    await expect(haupt.locator('.sl-teilung')).toContainText('4/1 (2,00 ha) + 4/2 (1,00 ha) = 3,00 ha');
    // der übrige Schlag steht noch unter "Neu" — mit dem Datum der Hauptzeile, nicht dem des Teilstücks
    const neu = page.locator('.sl-sec.is-neu .sl-item');
    await expect(neu).toHaveCount(1);
    await expect(neu).toContainText('Vermutlich aus der Teilung von 4 Langfeld (Umstellungsdatum 01.07.2020)');
    await expect(neu).not.toContainText('Abdrift');
    // nichts passiert von selbst: erst der Kontrolleur übernimmt
    await expect(haupt).not.toHaveClass(/is-done/);
    await haupt.locator('[data-sl-teilung]').click();
    await expect(haupt).toHaveClass(/is-done/);
    await expect(haupt).toContainText('zugeordnet: 4/1');
    await expect(haupt).toContainText('Geteilt: zusätzlich 4/2 (1,00 ha) als neue Zeile');
    await expect(neu).toHaveClass(/is-done/);
    await expect(neu.locator('[data-sl-beginn]')).toHaveValue('2020-07-01');
    await expect(page.locator('.sl-progress')).toHaveClass(/is-done/);

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#sl-export2').click()]);
    const out = await page.evaluate((b64) => { const wb = XLSX.read(b64, { type: 'base64' }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1); },
      (await streamToBuffer(await download.createReadStream())).toString('base64'));
    // [PK Feld, Bezeichnung, ha, Zugang, Status, Import Information]
    const pick = (r) => [r[1], r[4], r[10], r[13], r[15], r[17]];
    expect(out.map(pick)).toEqual([
      ['feld-m', '4 Langfeld', 2, '01.07.2020', OEKO, 'Updated'],                          // größter Schlag, Schlüssel bleiben
      ['feld-t', '4 Langfeld_Abdrift 2025', 0.2, '19.05.2025', 'Umstellungserzeugnisse', 'Updated'], // Name bleibt, 2. Jahr
      ['', '4 Langfeld', 1, '01.07.2020', OEKO, 'New']                                     // zweiter Schlag: neue Zeile, gleiches Datum
    ]);

    // Teilung lösen: Zeile wieder offen, Schlag wieder "neu" ohne Datum
    await page.locator('.sl-sec.is-warn > summary').click();
    await haupt.locator('[data-sl-teilung-weg]').click();
    await expect(haupt.locator('.sl-teilung')).toBeVisible();
    await expect(page.locator('.sl-sec.is-neu .sl-item [data-sl-beginn]')).toHaveValue('');
  });
});
