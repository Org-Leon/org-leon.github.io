import { test, expect } from '@playwright/test';
import { ladeShapeZip, rechteck } from './shapefile-helper.js';

// Flächenabgleich für einen Betrieb in Thüringen und Sachsen-Anhalt, nachgebaut
// nach einem Praxisfall (alle Daten frei erfunden):
// - Thüringer Shapes (VERONA 2026: SCHLAG, FLAECHE_HA, KULTURART-Code, FBI = FLIK), keine Flächennamen
// - Intact-Liste: Bezeichnung "Schlag + gekürzte FLIK", Schlagnummer ist eine interne Zählung
// - Kulturen müssen in den Kulturkatalog des externen Programms übersetzt werden
const TH_FELDER = [['ID', 'N', 10], ['FLAECHE_HA', 'N', 12, 4], ['SCHLAG', 'C', 10], ['ANTJAHR', 'C', 4], ['KULTURART', 'C', 10], ['FBI', 'C', 20]];
// [Platz, Schlag, FLIK, ha, Kulturart-Code]
const TH = [
  [0, '1', 'DETHLIAL99999A01', 10, '111150'],   // Winterweichweizen
  [1, '2', 'DETHLIAL99999B02', 5, '330000'],    // Sojabohnen
  [2, '2.1', 'DETHLIAL99999B02', 0.5, '510062'], // Blühstreifen, gleicher Feldblock wie Schlag 2
  [3, '3', 'DETHLIAL99999C03', 3, '793000'],    // Hanf
  [4, '1', 'DETHLIHK99999A07', 0.2, '960010'],  // Hecke (Landschaftselement)
  [5, '7', 'DETHLIAL99999D04', 4, '210004'],    // Erbsen — aus zwei Listenzeilen zusammengelegt
  [6, '9', 'DETHLIAL99999I05', 6, '190700']     // Emmer — FLIK in der Liste mit Tippfehler (1 statt I)
];
// Sachsen-Anhalt: Parzellen-Shape ohne Jahresfeld, Antragsjahr steht in der Begleit-XML
const ST_FELDER = [['NUMMER', 'N', 6], ['NAME', 'C', 30], ['FLAECHE', 'N', 12, 4], ['NUTZ_BEZ', 'C', 40]];
const ST_XML = '<?xml version="1.0" encoding="UTF-8"?><fa:flaechenantrag xmlns:fa="http://www.data-experts.de/Flaechen"><fa:antragsjahr>2026</fa:antragsjahr></fa:flaechenantrag>';

const HEADER = ['Kundennummer', 'PK Feld', 'PK Kultur', 'Schlagnummer', 'Bezeichnung', 'Flächenidentifikationsnummer', 'Kategorie', 'Kultur', 'Sorte', 'Zusatz', 'ha', 'Land', 'Bundesland', 'Zugang Fläche', 'Abgang Fläche', 'Status Feldstück', 'Fläche besichtigt im Jahr', 'Import Information'];
const OEKO = 'Ökologische Erzeugnisse';
const zeile = (pk, nr, bez, ha, kat, kultur, land = 'Thüringen', zugang = '01.07.2018') =>
  ['4711', 'feld-' + pk, 'kultur-' + pk, nr, bez, '', kat, kultur, '', '', ha, 'Deutschland', land, zugang, '', OEKO, '2025', 'Not updated'];
const LISTE = [
  zeile('a', '00010', '1 AL99999A01', 10, 'Getreide', 'Winterweizen'),
  zeile('b', '00011', '2 AL99999B02', 5, 'Sojabohnen', 'Sojabohnen'),
  zeile('c', '00012', '3 AL99999C03', 3, 'Getreide', 'Winterweizen'),
  zeile('d', '00013', '7 AL99999D04', 2.5, 'Mais', 'Körnermais'),
  zeile('e', '00014', '7 99999D04', 1.5, 'Mais', 'Körnermais'),
  zeile('f', '00015', '9 AL99999105', 6, 'Getreide', 'Winterweizen'),
  zeile('g', '00016', '101 Mühlberg', 6, 'Grün- und Raufutter', 'Kleegras, Klee-/Luzernegrasgemisch', 'Sachsen-Anhalt', '20.04.2018')
];
async function listeFile(page) {
  const b64 = await page.evaluate(({ HEADER, rows }) => {
    const ws = {};
    [HEADER, ...rows].forEach((r, ri) => HEADER.forEach((_, c) => {
      const v = r[c], ref = XLSX.utils.encode_cell({ r: ri, c });
      if (ri > 0 && c === 10) ws[ref] = { t: 'n', v, z: 'General' };
      else if (v === '' || v === undefined) ws[ref] = { t: 'z', z: '@' };
      else ws[ref] = { t: 's', v: String(v), z: '@' };
    }));
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: HEADER.length - 1 } });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Felder & Kulturen DE');
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  }, { HEADER, rows: LISTE });
  return { name: 'Flächendaten.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b64, 'base64') };
}
async function streamToBuffer(stream) { const c = []; for await (const x of stream) c.push(x); return Buffer.concat(c); }

test.describe('Flächenabgleich Thüringen / Sachsen-Anhalt', () => {
  test('zwei Bundesländer als ein Jahr, FLIK-Abgleich, Landschaftselemente, Zusammenlegung, Kulturen', async ({ page }) => {
    // Kategorie "Andere …" fragt per Eingabefeld; alle Rückfragen bestätigen
    page.on('dialog', d => (d.type() === 'prompt' ? d.accept('Körnerleguminosen') : d.accept()));
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await page.locator('.segment-btn[data-view="compare"]').click();

    // Thüringen-Zip (Jahr aus ANTJAHR, Ebene "Antragsflächen Hauptnutzung" ohne Fehlermeldung)
    await ladeShapeZip(page, 'compare-file-add', 'Antrag_Thueringen.zip', 'Antragsflächen Hauptnutzung_POLYGONE', TH_FELDER,
      TH.map(([, schlag, fbi, ha, code], i) => [9000 + i, ha.toFixed(4), schlag, '2026', code, fbi]), TH.map(([platz]) => rechteck(platz)));
    await expect(page.locator('.cy-row')).toHaveCount(1);
    await expect(page.locator('#compare-error-toast')).toBeHidden();
    // Sachsen-Anhalt dazu: Jahr aus der Antrags-XML, zusammengeführt
    await ladeShapeZip(page, 'compare-file-add', 'Antrag_Sachsen-Anhalt.zip', '160000000000_parzellen', ST_FELDER,
      [[1, 'Mühlberg', '6.0000', 'Winter-Emmer/-Einkorn']], [rechteck(10)], { '160000000000.nn.xml': ST_XML });
    await expect(page.locator('.cy-row')).toHaveCount(1);
    await expect(page.locator('.cy-row')).toContainText('Antrag_Thueringen.zip + Antrag_Sachsen-Anhalt.zip');
    await expect(page.locator('.cy-row')).toContainText('8 Flächen');

    await page.setInputFiles('#sl-file', await listeFile(page));
    await page.locator('#sl-stichtag').fill('2026-10-05');
    await page.locator('#sl-stichtag').dispatchEvent('change');

    // automatisch: 1, 2, 3 (FLIK gleich), 9 (FLIK mit Tippfehler), Mühlberg (Name + Fläche, Sachsen-Anhalt)
    await page.locator('.sl-sec.is-ok > summary').click();
    const auto = page.locator('.sl-sec.is-ok tbody tr');
    await expect(auto).toHaveCount(5);
    await expect(page.locator('.sl-sec.is-ok tr', { hasText: '9 AL99999105' })).toContainText('9');
    await expect(page.locator('.sl-sec.is-ok tr', { hasText: '101 Mühlberg' })).toContainText('Mühlberg');

    // Landschaftselement (Hecke) ist kein Fall
    await expect(page.locator('.sl-sec > summary', { hasText: 'Landschaftselemente und ausgeblendet (1)' })).toHaveCount(1);
    // gleicher Feldblock wie Schlag 2 -> Datum vorgeschlagen, Sammelknopf
    const neu = page.locator('.sl-sec.is-neu .sl-item');
    await expect(neu).toHaveCount(1);
    await expect(neu).toContainText('Gleicher Feldblock wie 2 AL99999B02');
    await page.locator('[data-sl-bulk="feldblock"]').click();
    await expect(page.locator('.sl-sec.is-neu [data-sl-beginn]')).toHaveValue('2018-07-01');

    // Zusammenlegung: 2,5 + 1,5 ha = Schlag 7 (4 ha)
    await expect(page.locator('.sl-zus').first()).toContainText('Zusammengelegt?');
    await page.locator('[data-sl-zusammen]').first().click();
    await expect(page.locator('[data-sl-zusammen]')).toHaveCount(0);
    await expect(page.locator('.sl-zus.is-done')).toContainText('übernommen');

    // Kulturen: Kategorien aus der festen Zuordnung (Hanf -> Hanf, Erbsen -> Körnerleguminosen);
    // Blühstreifen nur "ähnlich" -> bestätigen
    const kultur = page.locator('.sl-sec.is-kultur');
    const kulturZeile = (text) => kultur.locator('.sl-kitem').filter({ has: page.locator('.sl-liste', { hasText: text }) });
    await expect(kultur.locator('.sl-kbadge.is-unbekannt')).toHaveCount(0);
    await expect(kultur.locator('.sl-kat[data-sl-kategorie="Hanf"]')).toHaveValue('Hanf');
    await expect(kultur.locator('.sl-kat[data-sl-kategorie="Erbsen"]')).toHaveValue('Körnerleguminosen');
    await expect(kulturZeile('Blühstreifen').locator('[data-sl-kultur]')).toHaveValue('Grünbrache');
    // Kategorie lässt sich ändern und wird gemerkt
    await kultur.locator('.sl-kat[data-sl-kategorie="Grünbrache"]').selectOption({ label: 'Biotop' });
    await expect(kultur.locator('.sl-kat[data-sl-kategorie="Grünbrache"]')).toHaveValue('Biotop');
    while (await page.locator('[data-sl-kultur-ok]:visible').count()) await page.locator('[data-sl-kultur-ok]:visible').first().click();
    await expect(page.locator('.sl-progress')).toHaveClass(/is-done/);

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#sl-export2').click()]);
    const b64 = (await streamToBuffer(await download.createReadStream())).toString('base64');
    const rows = await page.evaluate((b64) => {
      const wb = XLSX.read(b64, { type: 'base64' });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1);
    }, b64);
    const byPk = Object.fromEntries(rows.map(r => [r[1] || 'neu-' + r[4], r]));
    // [Schlagnummer, Bezeichnung, Kategorie, Kultur, ha, Abgang]
    const pick = (r) => [r[3], r[4], r[6], r[7], r[10], r[14]];
    // Schlagnummer der Liste ist interne Zählung -> bleibt; Kultur aus den Shapes (gleich -> Schreibweise der Liste)
    expect(pick(byPk['feld-a'])).toEqual(['00010', '1 AL99999A01', 'Getreide', 'Winterweizen', 10, '']);
    expect(pick(byPk['feld-b'])).toEqual(['00011', '2 AL99999B02', 'Sojabohnen', 'Sojabohnen', 5, '']);
    expect(pick(byPk['feld-c'])).toEqual(['00012', '3 AL99999C03', 'Hanf', 'Hanf', 3, '']);
    expect(pick(byPk['feld-d'])).toEqual(['00013', '7 AL99999D04', 'Körnerleguminosen', 'Erbsen', 4, '']);
    expect(pick(byPk['feld-e'])[5]).toBe('05.10.2026');
    expect(pick(byPk['feld-f'])).toEqual(['00015', '9 AL99999105', 'Getreide', 'Winteremmer, Wintereinkorn', 6, '']);
    expect(pick(byPk['feld-g'])).toEqual(['00016', '101 Mühlberg', 'Getreide', 'Winteremmer, Wintereinkorn', 6, '']);
    // neue Zeile (Blühstreifen) mit Datum des Feldblocks, Bezeichnung Schlag + FLIK
    const neuZeile = rows.find(r => !r[1]);
    expect([neuZeile[4], neuZeile[6], neuZeile[7], neuZeile[10], neuZeile[13]]).toEqual(['2.1 AL99999B02', 'Biotop', 'Grünbrache', 0.5, '01.07.2018']);
    // keine Zeile für die Hecke
    expect(rows.some(r => /HK99999A07/.test(r[4]))).toBe(false);
  });

  test('Hecken/Feldgehölze: über die FLIK-Art erkannt, sonst unter "Neu" ausblendbar (kein Export)', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await page.locator('.segment-btn[data-view="compare"]').click();
    const felder = [
      [0, '1', 'DETHLIAL99999A01', 10, '111150'],  // Winterweichweizen (in der Liste)
      [1, '1', 'DETHLIFG99999A08', 0.3, ''],       // Feldgehölz: an der FLIK-Art erkannt
      [2, '5', 'DETHLIAL99999A01', 0.15, '']       // Gehölz ohne Kennung -> erst "neu", dann ausgeblendet
    ];
    await ladeShapeZip(page, 'compare-file-add', 'Antrag_Thueringen.zip', 'Antragsflächen Hauptnutzung_POLYGONE', TH_FELDER,
      felder.map(([, schlag, fbi, ha, code], i) => [9000 + i, ha.toFixed(4), schlag, '2026', code, fbi]), felder.map(([platz]) => rechteck(platz)));
    await page.setInputFiles('#sl-file', await listeFile(page));
    await page.locator('#sl-kultur-uebernehmen').uncheck();
    const leSec = page.locator('.sl-sec.is-le');
    await expect(leSec.locator('summary')).toContainText('Landschaftselemente und ausgeblendet (1)');
    await expect(leSec.locator('li')).toContainText('DETHLIFG99999A08');

    const neu = page.locator('.sl-sec.is-neu .sl-item');
    await expect(neu).toHaveCount(1);
    await expect(neu).toContainText('0,15 ha');
    await neu.locator('[data-sl-aus]').click();
    await expect(page.locator('.sl-sec.is-neu')).toHaveCount(0);
    await expect(leSec.locator('summary')).toContainText('(2)');
    await expect(leSec.locator('li', { hasText: 'ausgeblendet' })).toHaveCount(1);
    // ausgeblendet = kein offener Fall mehr, kommt nicht in den Export
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#sl-export2').click()]);
    const b64 = (await streamToBuffer(await download.createReadStream())).toString('base64');
    const rows = await page.evaluate((b64) => { const wb = XLSX.read(b64, { type: 'base64' }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1); }, b64);
    expect(rows.filter(r => !r[1])).toHaveLength(0);

    // wieder einblenden -> zurück unter "Neu"; auch per Rückgängig möglich
    await leSec.locator('summary').click();
    await leSec.locator('[data-sl-ein]').click();
    await expect(page.locator('.sl-sec.is-neu .sl-item')).toHaveCount(1);
    await page.locator('#sl-undo').click();
    await expect(page.locator('.sl-sec.is-neu')).toHaveCount(0);
  });

  test('Kulturen: Bundesland-Namen und Codes werden in den Katalog übersetzt', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/src/kulturen.js');
      const z = (t) => { const x = m.kulturZuordnen(t); return [x.name, x.sicherheit]; };
      return {
        weizen: z('Winterweichweizen'), emmer: z('Winter-Emmer/ -Einkorn'), mais: z('Körnermais oder CCM-Mais mit Untersaat'),
        hirse: z('Rispenhirse, Rutenhirse'), erbse: z('Sommer-Futtererbse (Felderbse, Peluschke)'), wiese: z('Wiesen (einschl. Streuobstwiesen)'),
        streuobst: z('Streuobstfläche mit Grünlandnutzung'), soja: z('Sojabohnen'), bluehen: z('Blühstreifen mehrjährig auf Ackerland (ÖR1a + ÖR1b)'),
        hafer: z('Hafer'), leer: z('Irgendwas Unbekanntes'), gemerkt: m.kulturZuordnen('Klee-Luzerne-Gemisch', { 'Klee-Luzerne-Gemisch': 'Luzerne' }).name,
        kategorie: [m.kategorieFuer('Winterweizen'), m.kategorieFuer('Kleegras, Klee-/Luzernegrasgemisch'), m.kategorieFuer('Erbsen'), m.kategorieFuer('Silomais'),
          m.kategorieFuer('Wintermenggetreide ohne Weizen'), m.kategorieFuer('Teichflächen'), m.kategorieFuer('Hanf', new Map([['Hanf', 'Sonstige']]))],
        alleGueltig: m.INTACT_KULTUREN.every(e => { const k = m.kategorieFuer(e.name); return !k || m.INTACT_KATEGORIEN.includes(k); })
      };
    });
    expect(r.weizen).toEqual(['Winterweizen', 'regel']);
    expect(r.emmer).toEqual(['Winteremmer, Wintereinkorn', 'regel']);
    expect(r.mais).toEqual(['Körnermais', 'regel']);
    expect(r.hirse).toEqual(['Hirse', 'regel']);
    expect(r.erbse).toEqual(['Erbsen', 'regel']);
    expect(r.wiese).toEqual(['Wiese', 'regel']);
    expect(r.streuobst).toEqual(['Grünland mit Streuobst', 'regel']);
    expect(r.soja).toEqual(['Sojabohnen', 'gleich']);
    expect(r.bluehen).toEqual(['Grünbrache', 'aehnlich']);
    expect(r.hafer).toEqual(['Sommerhafer', 'aehnlich']);
    expect(r.leer).toEqual(['', 'unbekannt']);
    expect(r.gemerkt).toBe('Luzerne');
    expect(r.kategorie).toEqual(['Getreide', 'Grün- und Raufutter', 'Körnerleguminosen', 'Mais', 'Getreidegemenge', null, 'Sonstige']);
    expect(r.alleGueltig).toBe(true);
  });

  test('Statustexte werden aus der Liste gelernt', async ({ page }) => {
    await page.goto('/');
    const texte = await page.evaluate(async () => {
      const m = await import('/src/schlagliste.js');
      const sl = m.slParse([['Schlagnummer', 'Bezeichnung', 'ha', 'Zugang Fläche', 'Status Feldstück'],
        ['1', '1 A', 1, '01.01.2018', 'Ökologische Erzeugnisse'], ['2', '2 B', 1, '18.09.2026', 'Nichtökologische Erzeugnisse (aus dem 1. Umstellungsjahr)']]);
      return m.slStatusTexteLernen(sl, '2026-10-05');
    });
    expect(texte).toEqual({ konv: 'Nichtökologische Erzeugnisse (aus dem 1. Umstellungsjahr)', oeko: 'Ökologische Erzeugnisse' });
  });
});

test('Kulturen: unsichere Zuordnung wird durch die Schlagliste bestätigt oder als Hinweis angeboten', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await page.goto('/');
  await page.evaluate(() => { try { localStorage.removeItem('feldfolio-kultur-zuordnung'); } catch { /* */ } });
  await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
  await page.locator('.segment-btn[data-view="compare"]').click();
  // Shapes mit Klartext-Kultur, die im Katalog nur "ähnlich" passt
  const fc = { type: 'FeatureCollection', features: [
    ['1', 'Blühflächen einjährig auf Ackerland (ÖR1a + ÖR1b)', 0.5, 'DETHLIAL99999A01'],
    ['2', 'Mischkultur von kleinkörnigen Leguminosen auch zusammen mit Nichtleguminosen', 1.2, 'DETHLIAL99999B02'],
    ['3', 'Sojabohnen', 4, 'DETHLIAL99999C03']
  ].map(([nr, kultur, ha, flik], i) => ({ type: 'Feature', properties: { SCHLAG_NR: nr, NUTZ_BEZ: kultur, FLAECHE: ha, FLIK: flik, JAHR: '2026' },
    geometry: { type: 'Polygon', coordinates: [rechteck(i)] } })) };
  await page.setInputFiles('#compare-file-add', { name: 'Antrag.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });
  const liste = [['Kundennummer', 'PK Feld', 'Schlagnummer', 'Bezeichnung', 'Kategorie', 'Kultur', 'ha', 'Bundesland', 'Zugang Fläche', 'Status Feldstück'],
    ['1', 'a', '1', '1 AL99999A01', 'Grünbrache', 'Grünbrache', 0.5, 'Thüringen', '01.07.2018', OEKO],
    ['1', 'b', '2', '2 AL99999B02', 'Körnerleguminosen', 'Sonstige Körnerleguminosen', 1.2, 'Thüringen', '01.07.2018', OEKO],
    ['1', 'c', '3', '3 AL99999C03', 'Getreide', 'Winterweizen', 4, 'Thüringen', '01.07.2018', OEKO]];
  const b64 = await page.evaluate((aoa) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Liste'); return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }); }, liste);
  await page.setInputFiles('#sl-file', { name: 'Liste.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b64, 'base64') });
  const kultur = page.locator('.sl-sec.is-kultur');
  const zeile = (text) => kultur.locator('.sl-kitem').filter({ has: page.locator('.sl-liste', { hasText: text }) });
  // Blühfläche -> Grünbrache steht so in der Liste: bestätigt
  await expect(zeile('Blühflächen').locator('.sl-kbadge')).toHaveText('wie in der Liste');
  await expect(zeile('Blühflächen')).toHaveClass(/is-done/);
  // Mischkultur: Vorschlag "Klee", Liste führt "Sonstige Körnerleguminosen" -> Hinweis mit Übernehmen
  await expect(zeile('Mischkultur')).not.toHaveClass(/is-done/);
  await expect(zeile('Mischkultur').locator('.sl-kliste')).toContainText('Sonstige Körnerleguminosen');
  await zeile('Mischkultur').locator('[data-sl-kultur-liste]').click();
  await expect(zeile('Mischkultur')).toHaveClass(/is-done/);
  await expect(zeile('Mischkultur').locator('[data-sl-kultur]')).toHaveValue('Sonstige Körnerleguminosen');
  // eindeutige Kultur: kein Vorjahres-Hinweis (wäre nur Fruchtwechsel)
  await expect(zeile('Sojabohnen').locator('.sl-kliste')).toHaveCount(0);
});
