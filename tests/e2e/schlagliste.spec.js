import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud } from './helpers.js';

// Jahresvergleich: Umnummerierte Flächen erkennen (gleiche Geometrie, neue
// Nummer) und — nur angemeldet — eine externe Schlagliste (Excel "Felder &
// Kulturen") mit den Shapes eines Jahres abgleichen, Umstellungsstatus
// berechnen und die Liste im gleichen Format für den Wiederimport exportieren.
// Alle Daten frei erfunden.

// Feste Lage je "Platz", damit eine umnummerierte Fläche dieselbe Geometrie behält.
const PLATZ = { A: 0, B: 1, C: 2, D: 3, E: 4 };
const JAHRE = {
  2025: [['A', '1', 'Acker Nord', 'Weizen', '2.00'], ['B', '2', 'Wiese', 'Wiese', '1.50'], ['C', '3', 'Alter Acker', 'Mais', '1.00']],
  2026: [['A', '1', 'Acker Nord', 'Hafer', '2.00'], ['B', '7', 'Wiese', 'Wiese', '1.50'], ['D', '4', 'Neuland', 'Kleegras', '0.90'], ['E', '8', 'Senke', 'Roggen', '1.20']]
};
// Zeile: [Platz, Nummer, Name, Kultur, ha, Breite in Grad (optional, Standard 0.003)]
function yearFile(jahr, jahre = JAHRE) {
  const fc = { type: 'FeatureCollection', features: jahre[jahr].map(([platz, nr, name, kultur, ha, breite = 0.003]) => {
    const x = 11.80 + PLATZ[platz] * 0.004, y = 48.40;
    return { type: 'Feature', properties: { SCHLAG_NR: nr, NAME: name, NUTZ_BEZ: kultur, FLAECHE: ha, JAHR: String(jahr) },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + breite, y], [x + breite, y + 0.002], [x, y + 0.002], [x, y]]] } };
  }) };
  return { name: `Antrag_${jahr}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) };
}
const HEADER = ['Kundennummer', 'PK Feld', 'PK Kultur', 'Schlagnummer', 'Bezeichnung', 'Flächenidentifikationsnummer', 'Kategorie', 'Kultur', 'Sorte', 'Zusatz', 'ha', 'Land', 'Bundesland', 'Zugang Fläche', 'Abgang Fläche', 'Status Feldstück', 'Fläche besichtigt im Jahr', 'Import Information'];
const OEKO = 'Ökologische Erzeugnisse';
const row = (pk, nr, bez, ha, zugang, status = OEKO) => ['99999', 'feld-' + pk, 'kultur-' + pk, nr, bez, '', 'Getreide', 'Weizen', '', '', ha, 'Deutschland', 'Bayern', zugang, '', status, '2024', 'Not updated'];
const LISTE = [
  row('a', '00001', '1 Acker Nord', 2, '01.01.2000'),                       // sicher
  row('b', '00002', '2 Wiese', 1.5, '01.03.2025', 'Umstellungserzeugnisse'), // 2026 als Nr. 7 (umnummeriert)
  row('c', '00003', '3 Alter Acker', 1, '01.01.2000'),                       // 2026 nicht mehr da
  row('d', '00006', '6 Senke', 1, '01.01.2000'),                             // Zweifelsfall (Nummer anders, Fläche anders)
  ['99999', 'feld-e', 'kultur-e', '00023']                                   // unvollständig
];
async function schlaglisteFile(page, rows = LISTE) {
  const b64 = await page.evaluate(({ HEADER, rows }) => {
    const ws = {};
    [HEADER, ...rows].forEach((r, ri) => HEADER.forEach((_, c) => {
      const v = r[c];
      const ref = XLSX.utils.encode_cell({ r: ri, c });
      if (ri > 0 && c === 10 && typeof v === 'number') ws[ref] = { t: 'n', v, z: 'General' };
      else if (v === undefined || v === '') ws[ref] = { t: 'z', z: '@' };
      else ws[ref] = { t: 's', v: String(v), z: '@' };
    }));
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: HEADER.length - 1 } });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Felder & Kulturen DE');
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  }, { HEADER, rows });
  return { name: 'Felder_&_Kulturen_DE.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b64, 'base64') };
}
const openCompare = (page) => page.locator('.segment-btn[data-view="compare"]').click();
const fortschritt = (page) => page.locator('#sl-progress-wrap .sl-prog-count');

test.describe('Jahresvergleich: Umnummerierung und Schlagliste (Umstellung)', () => {
  test('nur die Nummer geändert: ein Eintrag "Umnummeriert" statt Abgang + Zugang', async ({ page }) => {
    await page.goto('/');
    await openCompare(page);
    await page.setInputFiles('#compare-file-add', [yearFile(2025), yearFile(2026)]);
    await page.locator('#btn-compare-run').click();
    const summary = page.locator('#compare-summary');
    await expect(summary).toContainText('2Zugänge');       // 4 Neuland, 8 Senke
    await expect(summary).toContainText('1Abgänge');       // 3 Alter Acker
    await expect(summary).toContainText('1Umnummeriert');
    const umnr = page.locator('#compare-table-body tr', { hasText: 'Umnummeriert' });
    await expect(umnr).toHaveCount(1);
    await expect(umnr).toContainText('2 → 7');
    await expect(umnr).toContainText('Wiese');
    await expect(page.locator('#compare-table-body tr', { hasText: /^Zugang\s+7/ })).toHaveCount(0);
    await expect(page.locator('#compare-legend')).toContainText('Umnummeriert');
  });

  test('Schlagliste nur angemeldet; abgleichen, Zweifelsfälle klären, für den Import exportieren', async ({ page }) => {
    await page.goto('/');
    await openCompare(page);
    await expect(page.locator('#sl-box')).toBeHidden();
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await expect(page.locator('#sl-box')).toBeVisible();
    await page.setInputFiles('#compare-file-add', [yearFile(2025), yearFile(2026)]);
    await page.setInputFiles('#sl-file', await schlaglisteFile(page));

    // Dialog öffnet sich; Flächen aus dem neuesten Jahr
    await expect(page.locator('#sl-overlay')).toBeVisible();
    // Kulturen hier nicht übernehmen (eigener Test in flaechenabgleich-thueringen.spec.js)
    await page.locator('#sl-kultur-uebernehmen').uncheck();
    await expect(page.locator('#sl-jahr')).toHaveValue('2026');
    await page.locator('#sl-stichtag').fill('2026-10-05');
    await page.locator('#sl-stichtag').dispatchEvent('change');
    // Fälle: prüfen (6 Senke) · neu (4 Neuland) · nicht in 2026 (3 Alter Acker); 1 und 2→7 automatisch
    await expect(fortschritt(page)).toHaveText('0 von 3 Fällen geklärt');
    await expect(page.locator('.sl-sec.is-ok > summary')).toContainText('Automatisch zugeordnet (2)');
    await expect(page.locator('.sl-sec.is-krit')).toHaveCount(0);
    // Karte: Flächen des Abgleichsjahres und die weggefallene Vorjahresfläche
    await expect(page.locator('#map path.sl-flaeche')).toHaveCount(4);
    await expect(page.locator('#map path.sl-fehlt')).toHaveCount(1);

    // Zweifelsfall: Vorschlag "8 Senke" bestätigen
    const zweifel = page.locator('.sl-sec.is-warn .sl-item');
    await expect(zweifel).toHaveCount(1);
    await expect(zweifel).toContainText('6 Senke');
    await expect(zweifel.locator('select option:checked')).toContainText('8 Senke');
    await expect(zweifel.locator('.sl-why')).toContainText('Shape +0,20 ha gegenüber Liste');
    await zweifel.locator('[data-sl-ok]').click();
    await expect(fortschritt(page)).toHaveText('1 von 3 Fällen geklärt');
    // bleibt abgehakt stehen (nicht verschwinden), mit "ändern" zurück
    await expect(zweifel).toHaveClass(/is-done/);
    await expect(zweifel).toContainText('zugeordnet: 8 Senke');
    await expect(page.locator('.sl-sec.is-warn > summary .sl-sec-chip')).toContainText('erledigt');

    // Neue Fläche: Umstellungsbeginn per 1.1. (Bayern-Rückdatierung) -> 1. Jahr konventionell
    const neu = page.locator('.sl-sec.is-neu .sl-item');
    await expect(neu).toContainText('4 Neuland');
    await neu.locator('[data-sl-jan]').click();
    await expect(page.locator('.sl-sec.is-neu [data-sl-beginn]')).toHaveValue('2026-01-01');
    await expect(page.locator('.sl-sec.is-neu .sl-badge')).toHaveText('konv.');

    // Nicht mehr in den Shapes: Abgang eintragen
    const fehlt = page.locator('.sl-sec.is-fehlt .sl-item');
    await expect(fehlt).toContainText('3 Alter Acker');
    await fehlt.locator('[data-sl-abgang]').check();
    await expect(page.locator('.sl-sec.is-fehlt [data-sl-abgang]')).toBeChecked();
    await expect(page.locator('.sl-progress')).toHaveClass(/is-done/);
    await expect(page.locator('.sl-progress')).toContainText('Alles geklärt');

    // Status: 2 Wiese seit 01.03.2025 -> am 05.10.2026 im 2. Jahr (Umstellung)
    await page.locator('.sl-sec.is-ok > summary').click();
    await expect(page.locator('.sl-sec.is-ok tr', { hasText: '2 Wiese' }).locator('.sl-badge')).toHaveText('Umstellung');
    await expect(page.locator('.sl-sec.is-ok tr', { hasText: '2 Wiese' }).locator('.sl-chip')).toHaveText('Nr. 2 → 7');
    await expect(page.locator('.sl-sec.is-ok tr', { hasText: '1 Acker Nord' }).locator('.sl-badge')).toHaveText('Bio');

    // Bezeichnung der 1. Stufe wie im externen Programm
    await page.locator('.sl-texte summary').click();
    await page.locator('[data-sl-text="konv"]').fill('Konventionell (Test)');
    await page.locator('[data-sl-text="konv"]').dispatchEvent('change');

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#sl-export2').click()]);
    expect(download.suggestedFilename()).toBe('Felder_&_Kulturen_DE (abgeglichen 2026-10-05).xlsx');
    const b64 = (await streamToBuffer(await download.createReadStream())).toString('base64');
    const out = await page.evaluate((b64) => {
      const wb = XLSX.read(b64, { type: 'base64', cellNF: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return { sheet: wb.SheetNames[0], fmtD2: ws.D2.z, typK2: ws.K2.t, rows: XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) };
    }, b64);
    expect(out.sheet).toBe('Felder & Kulturen DE');
    expect(out.rows[0]).toEqual(HEADER);
    expect(out.fmtD2).toBe('@');
    expect(out.typK2).toBe('n');
    const byPk = Object.fromEntries(out.rows.slice(1).map(r => [r[1] || 'neu', r]));
    // [Schlagnummer, Bezeichnung, ha, Zugang, Abgang, Status]
    const pick = (r) => [r[3], r[4], r[10], r[13], r[14], r[15]];
    expect(pick(byPk['feld-a'])).toEqual(['00001', '1 Acker Nord', 2, '01.01.2000', '', OEKO]);
    expect(pick(byPk['feld-b'])).toEqual(['00007', '7 Wiese', 1.5, '01.03.2025', '', 'Umstellungserzeugnisse']);
    expect(pick(byPk['feld-c'])).toEqual(['00003', '3 Alter Acker', 1, '01.01.2000', '05.10.2026', OEKO]);
    expect(pick(byPk['feld-d'])).toEqual(['00008', '8 Senke', 1.2, '01.01.2000', '', OEKO]);
    expect(byPk['feld-e'].slice(0, 4)).toEqual(['99999', 'feld-e', 'kultur-e', '00023']);
    expect(byPk['feld-a'][2]).toBe('kultur-a'); // Schlüssel unverändert
    expect(pick(byPk['neu'])).toEqual(['00004', '4 Neuland', 0.9, '01.01.2026', '', 'Konventionell (Test)']);
    expect(byPk['neu'][0]).toBe('99999');
    expect(byPk['neu'][2]).toBe('');

    // Spalte "Umstellung" in der Vergleichstabelle
    await page.locator('#sl-close').click();
    await expect(page.locator('#sl-summary')).toContainText('Alles geklärt');
    await page.locator('#btn-compare-run').click();
    await expect(page.locator('#compare-th-umst')).toBeVisible();
    await expect(page.locator('#compare-table-body tr', { hasText: '2 → 7' }).locator('.sl-badge')).toHaveText('Umstellung');
    await expect(page.locator('#compare-table-body tr', { hasText: 'Neuland' }).locator('.sl-badge')).toHaveText('konv.');
    // abgemeldet: Spalte und Bereich weg
    await page.evaluate(() => window.__ffTestTk.logoutFake());
    await expect(page.locator('#compare-th-umst')).toBeHidden();
    await expect(page.locator('#sl-box')).toBeHidden();
  });

  test('Abgleich auf der Karte: Teilstück dazugekommen -> Unterfläche mit eigenem Umstellungsbeginn', async ({ page }) => {
    const jahre = {
      2025: [['A', '1', 'Acker', 'Weizen', '2.00']],
      2026: [['A', '1', 'Acker', 'Hafer', '3.00', 0.0045]] // nach Osten um ein Teilstück gewachsen
    };
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await openCompare(page);
    await page.setInputFiles('#compare-file-add', [yearFile(2025, jahre), yearFile(2026, jahre)]);
    await page.setInputFiles('#sl-file', await schlaglisteFile(page, [row('a', '00001', '1 Acker', 2, '01.01.2000')]));
    await page.locator('#sl-kultur-uebernehmen').uncheck();
    await page.locator('#sl-stichtag').fill('2026-10-05');
    await page.locator('#sl-stichtag').dispatchEvent('change');

    // Kritische Änderung: Teilstück, auf der Karte rot
    const krit = page.locator('.sl-sec.is-krit .sl-item');
    await expect(krit).toHaveCount(1);
    await expect(krit).toContainText('Teilstück dazugekommen');
    await expect(page.locator('#map path.sl-teilstueck')).toHaveCount(1);
    // Fälle: Teilstück + Zweifelsfall (Fläche laut Liste 2 ha, Shape 3 ha)
    await expect(fortschritt(page)).toHaveText('0 von 2 Fällen geklärt');

    // Fall antippen -> Karte zeigt ihn (Hervorhebung), Auge "angesehen"
    await krit.locator('.sl-liste').click();
    await expect(krit).toHaveClass(/is-focus/);
    await expect(page.locator('#map path.sl-focus').first()).toBeAttached();
    await expect(krit.locator('.sl-eye')).toHaveCount(1);
    // Fläche auf der Karte antippen -> zugehöriger Fall im Panel
    await page.locator('#map path.sl-flaeche').first().dispatchEvent('click');
    await expect(krit).toHaveClass(/is-focus/);

    await page.locator('.sl-sec.is-warn [data-sl-ok]').click();
    await expect(fortschritt(page)).toHaveText('1 von 2 Fällen geklärt');

    // Unterfläche mit eigenem Umstellungsbeginn
    await page.locator('[data-sl-unter-datum]').fill('2026-01-01');
    await page.locator('[data-sl-unter]').click();
    const unter = page.locator('.sl-sec.is-krit .sl-unter');
    await expect(unter).toContainText('Unterfläche');
    await expect(unter).toContainText('ab 01.01.2026');
    await expect(unter.locator('.sl-badge')).toHaveText('konv.');
    await expect(page.locator('.sl-sec.is-krit .sl-item')).toHaveClass(/is-done/);
    // alles geklärt: Feier
    await expect(fortschritt(page)).toHaveText('2 von 2 Fällen geklärt');
    await expect(page.locator('.sl-progress')).toHaveClass(/is-done/);
    await expect(page.locator('#sl-overlay .sl-confetti')).toHaveCount(1);

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#sl-export2').click()]);
    const b64 = (await streamToBuffer(await download.createReadStream())).toString('base64');
    const rows = await page.evaluate((b64) => {
      const wb = XLSX.read(b64, { type: 'base64' });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1);
    }, b64);
    expect(rows).toHaveLength(2);
    const [haupt, teil] = rows;
    expect([haupt[1], haupt[3], haupt[4], haupt[13], haupt[15]]).toEqual(['feld-a', '00001', '1 Acker', '01.01.2000', OEKO]);
    expect([teil[1], teil[2], teil[3], teil[4], teil[13], teil[15]]).toEqual(['', '', '00001', '1 Acker – Teilstück 2026', '01.01.2026', 'Nichtökologische Erzeugnisse (aus dem 1. Umstellungsjahr)']);
    expect(teil[10]).toBeGreaterThan(0.5);
    expect(Math.round((haupt[10] + teil[10]) * 10000) / 10000).toBe(3);

    // Panel schließen -> Karte wieder im Jahresvergleich, Übersicht "Alles geklärt"
    await page.locator('#sl-close').click();
    await expect(page.locator('#sl-overlay')).toBeHidden();
    await expect(page.locator('#map path.sl-flaeche')).toHaveCount(0);
    await expect(page.locator('#sl-summary')).toContainText('Alles geklärt');
  });

  test('Abgleich: Rückgängig springt zur Fläche zurück, Zurücksetzen verwirft alle Entscheidungen', async ({ page }) => {
    await page.goto('/');
    await openCompare(page);
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    // Abgleich-Karte steht direkt unter den hinterlegten Jahren (vor "Vergleichen")
    const reihenfolge = await page.evaluate(() => {
      const box = document.getElementById('sl-box'), pair = document.getElementById('compare-pair');
      return !!(box.compareDocumentPosition(pair) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(reihenfolge).toBe(true);
    await page.setInputFiles('#compare-file-add', [yearFile(2025), yearFile(2026)]);
    await page.setInputFiles('#sl-file', await schlaglisteFile(page));
    await expect(page.locator('#sl-overlay')).toBeVisible();
    await page.locator('#sl-kultur-uebernehmen').uncheck();
    const undo = page.locator('#sl-undo');
    await expect(fortschritt(page)).toHaveText('0 von 3 Fällen geklärt');

    // drei Entscheidungen
    await page.locator('.sl-sec.is-warn [data-sl-ok]').click();
    await page.locator('.sl-sec.is-neu [data-sl-jan]').click();
    await page.locator('.sl-sec.is-fehlt [data-sl-abgang]').check();
    await expect(fortschritt(page)).toHaveText('3 von 3 Fällen geklärt');
    await expect(undo).toBeEnabled();

    // Rückgängig: Abgang weg, Fokus auf dieser Zeile
    await undo.click();
    await expect(fortschritt(page)).toHaveText('2 von 3 Fällen geklärt');
    await expect(page.locator('.sl-sec.is-fehlt [data-sl-abgang]')).not.toBeChecked();
    await expect(page.locator('.sl-sec.is-fehlt .sl-item')).toHaveClass(/is-focus/);
    // nochmal: Umstellungsbeginn der neuen Fläche weg
    await undo.click();
    await expect(page.locator('.sl-sec.is-neu [data-sl-beginn]')).toHaveValue('');
    await expect(page.locator('.sl-sec.is-neu .sl-item')).toHaveClass(/is-focus/);
    await expect(fortschritt(page)).toHaveText('1 von 3 Fällen geklärt');

    // Zurücksetzen (mit Rückfrage) -> alles offen, Zweifelsfall wieder zu prüfen
    page.once('dialog', d => d.accept());
    await page.locator('#sl-reset2').click();
    await expect(fortschritt(page)).toHaveText('0 von 3 Fällen geklärt');
    await expect(page.locator('.sl-sec.is-warn [data-sl-ok]')).toBeVisible();
    // ... und auch das lässt sich zurücknehmen
    await undo.click();
    await expect(fortschritt(page)).toHaveText('1 von 3 Fällen geklärt');
    // Zurücksetzen auch aus der Seitenleiste
    await page.locator('#sl-close').click();
    page.once('dialog', d => d.accept());
    await page.locator('#btn-sl-reset').click();
    await expect(page.locator('#sl-summary')).toContainText('Noch 3 Fälle zu klären');
  });

  test('Abschnitte: klappen zu, sobald erledigt; selbst zugeklappt bleibt zu', async ({ page }) => {
    await page.goto('/');
    await openCompare(page);
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await page.setInputFiles('#compare-file-add', [yearFile(2025), yearFile(2026)]);
    await page.setInputFiles('#sl-file', await schlaglisteFile(page));
    await page.locator('#sl-kultur-uebernehmen').uncheck();
    const warn = page.locator('.sl-sec.is-warn'), neu = page.locator('.sl-sec.is-neu'), fehlt = page.locator('.sl-sec.is-fehlt');
    await expect(warn).toHaveAttribute('open', '');
    // "Neu" selbst zuklappen, dann woanders etwas erledigen -> bleibt zu
    await neu.locator('> summary').click();
    await expect(neu).not.toHaveAttribute('open');
    await warn.locator('[data-sl-ok]').click();
    await expect(fortschritt(page)).toHaveText('1 von 3 Fällen geklärt');
    await expect(neu).not.toHaveAttribute('open');
    // Zweifelsfälle sind erledigt -> zugeklappt
    await expect(warn).not.toHaveAttribute('open');
    // erledigten Abschnitt selbst öffnen -> bleibt bei weiteren Aktionen offen
    await warn.locator('> summary').click();
    await expect(warn).toHaveAttribute('open', '');
    await fehlt.locator('[data-sl-abgang]').check();
    await expect(fortschritt(page)).toHaveText('2 von 3 Fällen geklärt');
    await expect(warn).toHaveAttribute('open', '');
    await expect(fehlt).not.toHaveAttribute('open'); // gerade fertig geworden
  });

  test('Nach dem Agrarantrag (15.05.) zugegangen: kein Abgang, Zeile bleibt; Bio-Zugang per Knopf', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await page.goto('/');
    await openCompare(page);
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await page.setInputFiles('#compare-file-add', [yearFile(2025), yearFile(2026)]);
    const liste = [...LISTE.slice(0, 4),
      row('x', '00030', '30 Pachtacker', 2.5, '01.07.2026', 'Nichtökologische Erzeugnisse (aus dem 1. Umstellungsjahr)'), // nach Antrag, konventionell
      row('y', '00031', '31 Biowiese', 1.8, '01.03.2021')];                                                                 // Bio-Zugang, Datum vom Vorbewirtschafter
    await page.setInputFiles('#sl-file', await schlaglisteFile(page, liste));
    await page.locator('#sl-kultur-uebernehmen').uncheck();
    await page.locator('#sl-stichtag').fill('2026-10-05');
    await page.locator('#sl-stichtag').dispatchEvent('change');
    // 30 automatisch (Zugang nach dem 15.05.2026): kein Fall
    const nach = page.locator('.sl-sec.is-nachantrag');
    await expect(nach.locator('summary')).toContainText('Nach dem Agrarantrag zugegangen (1)');
    await expect(nach.locator('li')).toContainText('30 Pachtacker');
    const fehlt = page.locator('.sl-sec.is-fehlt .sl-item');
    await expect(fehlt).toHaveCount(2); // 3 Alter Acker, 31 Biowiese
    await expect(fortschritt(page)).toHaveText('0 von 4 Fällen geklärt');
    // 31: per Knopf als nach Antrag zugegangen
    await fehlt.filter({ hasText: '31 Biowiese' }).locator('[data-sl-nach]').click();
    await expect(nach.locator('summary')).toContainText('(2)');
    await expect(fortschritt(page)).toHaveText('0 von 3 Fällen geklärt');
    // Export: beide ohne Abgang, Status fortgeschrieben
    await page.locator('.sl-sec.is-warn [data-sl-ok]').click();
    await page.locator('.sl-sec.is-neu [data-sl-jan]').click();
    await page.locator('.sl-sec.is-fehlt [data-sl-abgang]').check();
    await expect(page.locator('.sl-progress')).toHaveClass(/is-done/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#sl-export2').click()]);
    const b64 = (await streamToBuffer(await download.createReadStream())).toString('base64');
    const rows = await page.evaluate((b64) => { const wb = XLSX.read(b64, { type: 'base64' }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1); }, b64);
    const byPk = Object.fromEntries(rows.map(r => [r[1], r]));
    expect([byPk['feld-x'][4], byPk['feld-x'][10], byPk['feld-x'][13], byPk['feld-x'][14]]).toEqual(['30 Pachtacker', 2.5, '01.07.2026', '']);
    expect([byPk['feld-y'][4], byPk['feld-y'][14], byPk['feld-y'][15]]).toEqual(['31 Biowiese', '', OEKO]);
    // "doch nicht" -> wieder ein Fall unter "Nicht in den Shapes"
    await nach.locator('summary').click();
    await nach.locator('li', { hasText: '30 Pachtacker' }).locator('[data-sl-nach-nein]').click();
    await expect(page.locator('.sl-sec.is-fehlt .sl-item', { hasText: '30 Pachtacker' })).toHaveCount(1);
  });

  test('Schlagliste und Zuordnungen bleiben beim Betrieb gespeichert', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await page.evaluate(() => { window.__ffTestTk.addEvent({ kunde: 'Hof A' }); window.__ffTestTk.addEvent({ kunde: 'Hof B' }); });
    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof A'));
    await openCompare(page);
    await page.setInputFiles('#compare-file-add', [yearFile(2025), yearFile(2026)]);
    await page.setInputFiles('#sl-file', await schlaglisteFile(page));
    await page.locator('.sl-sec.is-warn [data-sl-ok]').click();
    await page.locator('#sl-close').click();
    await expect(page.locator('#sl-summary')).toContainText('Felder_&_Kulturen_DE.xlsx');

    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof B'));
    await expect(page.locator('#btn-sl-review')).toBeHidden();
    await expect(page.locator('#sl-summary .sl-file')).toHaveCount(0);

    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof A'));
    await expect(page.locator('#sl-summary')).toContainText('Felder_&_Kulturen_DE.xlsx');
    await expect(page.locator('#sl-summary .sl-mini span').nth(1)).toHaveText('0 prüfen');
    await expect(page.locator('#sl-summary .sl-mini span').first()).toHaveText('3 zugeordnet');
  });

  test('Umstellungsstufen ab festem Datum: 12 / 24 Monate; Besichtigt-Jahr im Export', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/src/schlagliste.js');
      const st = (d) => m.slStufe('2025-01-01', d).key;
      const sl = m.slParse([['Schlagnummer', 'Bezeichnung', 'ha', 'Zugang Fläche', 'Status Feldstück', 'Fläche besichtigt im Jahr'], ['01', '1 Feld', 1, '01.01.2025', '', '2023']]);
      const feats = [{ key: 'k1', nummer: '1', name: 'Feld', ha: 1 }];
      const ab = m.slAbgleich(sl, feats);
      const aoa = m.slExportZeilen(sl, ab, { featByKey: new Map(feats.map(f => [f.key, f])), stichtag: '2026-06-30', statusTexte: m.SL_STATUS_STANDARD, besichtigt: new Set(['k1']) });
      return { stufen: [st('2025-12-31'), st('2026-01-01'), st('2026-12-31'), st('2027-01-01')], art: ab.zeilen[0].art, zeile: aoa[1] };
    });
    expect(r.stufen).toEqual(['konv', 'umst', 'umst', 'oeko']);
    expect(r.art).toBe('sicher');
    expect(r.zeile).toEqual(['01', '1 Feld', 1, '01.01.2025', 'Umstellungserzeugnisse', '2026']);
  });
});

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}
