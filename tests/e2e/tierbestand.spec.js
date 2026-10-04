import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud } from './helpers.js';

// Tierbestand: HIT-Bestandsregister (PDF) laden, Bestand/Zu-/Abgänge,
// Altersklassen, Stickstoff und Tierbesatz, Zuordnung zu Stallabteilen.
// Der Auszug hier ist frei erfunden (Ohrmarken DE 99 …, Musterbetrieb) und
// wird im Browser mit dem jsPDF der App als PDF gebaut — Aufbau wie das
// Bestandsregister "Standard" (eine Textzeile je Tier, Kopf mit Anschrift).
// Zeitraum 01.01.2025–31.12.2025 (365 Tage):
//   Anfang 7 + Zugänge 2 (1 Geburt, 1 Zukauf) − Abgänge 3 (Verkauf, Verendung, Hausschlachtung) = 6
const ZEILEN = [
  'DE 99 000 00001 01.03.2018 W GAL DE 99 000 00090 01.01.2020 ZU 99 000 000 0001 1,000',
  'DE 99 000 00002 01.03.2017 W GAL DE 99 000 00091 01.01.2020 ZU 99 000 000 0001 1,000',
  'DE 99 000 00003 01.03.2019 M LIM DE 99 000 00092 01.01.2020 ZU 99 000 000 0001 1,000',
  'DE 99 000 00004 01.10.2025 W GAL DE 99 000 00001 01.10.2025 GE 0,076',
  'DE 99 000 00005 01.09.2024 M GAL DE 99 000 00001 01.09.2024 GE 0,552',
  'DE 99 000 00006 01.05.2023 M GAL DE 99 000 00099 01.05.2023 GE 01.07.2025 AB 99 000 000 0002 0,364',
  'DE 99 000 00007 01.03.2016 W GAL DE 99 000 00093 01.01.2020 ZU 99 000 000 0001 02.03.2025 VE 0,164',
  'FR 999 000 0008 01.01.2022 W AU FR 999 000 0098 01.06.2025 ZU 99 000 000 0003 Frankreich 0,586',
  'DE 99 000 00009 01.02.2021 M GAL DE 99 000 00094 01.02.2021 GE 01.11.2025 HS 0,833'
];
// Spaltenpositionen wie im Auszug (ein Textstück je Zelle)
function buildPdf(zeilen) {
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
  doc.setFontSize(8);
  const head = () => {
    doc.text('Musterhof Beispiel GbR', 20, 10); doc.text('Bestandsregister - Standard', 120, 10);
    doc.text('Hr. Max Mustermann', 20, 14); doc.text('von 01.01.2025 bis 31.12.2025', 120, 14);
    doc.text('Musterweg 1', 20, 18); doc.text('12345 Musterstadt', 20, 22); doc.text('Tel.: 0123456789', 20, 26);
    doc.text('Betrieb: 99 000 000 0000', 20, 30);
    doc.text('Ohrmarke', 12, 38); doc.text('Geb.datum', 70, 38); doc.text('Rasse', 98, 38); doc.text('GVE', 270, 38);
  };
  head();
  const X = [12, 70, 90, 98, 112, 142, 162, 170, 196, 216, 224, 250, 270];
  zeilen.forEach((z, i) => {
    if (i === 5) { doc.addPage(); head(); }
    const m = /^(\S+ \S+ \S+ \S+) (\S+) (\S) (\S+) (\S+ \S+ \S+ \S+) (\S+) (\S\S)(?: (\d\d \d{3} \d{3} \d{4}))?(?: (\d\d\.\d\d\.\d{4}) (\S\S))?(?: (\d\d \d{3} \d{3} \d{4}))?(?: ([A-Za-z]+))? (\d,\d{3})$/.exec(z);
    const cells = [m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12], m[13]];
    const y = 46 + (i % 5) * 7;
    cells.forEach((c, ci) => { if (c) doc.text(c, X[ci], y); });
  });
  doc.addPage();
  doc.text('Auswertung der Tabelle:', 20, 30);
  doc.text('9 Datensätze wurden in der HIT- Datenbank für diese Tabelle gefunden.', 20, 40);
  doc.text('Die ermittelten GVE betragen: 5,575 .', 20, 46);
  doc.text('Am Ende des betrachteten Zeitraums zum 31.12.2025 befanden sich 6 Tiere am Betrieb.', 20, 52);
  return doc.output('datauristring').split(',')[1];
}
async function hitPdf(page, zeilen = ZEILEN) {
  const b64 = await page.evaluate(`(${buildPdf.toString()})(${JSON.stringify(zeilen)})`);
  return { name: 'Bestandsregister.pdf', mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') };
}
const open = (page) => page.locator('.segment-btn[data-view="tiere"]').click();

test.describe('Tierbestand (HIT-Auszug)', () => {
  test('Auszug laden: Bestand, Zu- und Abgänge, Altersklassen, Kontrollsummen', async ({ page }) => {
    await page.goto('/');
    await open(page);
    await expect(page.locator('#current-view-title')).toHaveText('Tierbestand');
    await expect(page.locator('#tb-empty')).toBeVisible();
    await page.setInputFiles('#tb-file-empty', await hitPdf(page));
    await expect(page.locator('#tb-content')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#tb-subtitle')).toContainText('01.01.2025 – 31.12.2025');

    const kpis = page.locator('#tb-kpis .ue-kpi');
    await expect(kpis.nth(0)).toContainText('6Tiere');
    await expect(kpis.nth(0)).toContainText('4,9 GV am Stichtag');
    await expect(kpis.nth(1)).toContainText('davon 1 Geburten');
    await expect(kpis.nth(2)).toContainText('davon 1 verendet/tot');
    await expect(kpis.nth(3)).toContainText('5,6');
    await expect(page.locator('#tb-check .tb-check')).toHaveClass(/is-ok/);
    await expect(page.locator('#tb-check')).toContainText('9 von 9 Datensätzen gelesen');

    // Anfang 7 + 2 − 3 = 6
    await expect(page.locator('#tb-bilanz b')).toHaveText(['7', '2', '3', '6']);
    await expect(page.locator('#tb-zugaenge .tb-art[data-art="GE"]')).toContainText('Geburt im Betrieb');
    await expect(page.locator('#tb-zugaenge .tb-art[data-art="ZU"] .tb-art-n')).toHaveText('1');
    await expect(page.locator('#tb-abgaenge .tb-art')).toHaveCount(3);
    await expect(page.locator('#tb-abgaenge .tb-art[data-art="HS"]')).toContainText('Hausschlachtung');
    await expect(page.locator('#tb-abgaenge .tb-art[data-art="VE"]')).toContainText('Verendung');
    await expect(page.locator('#tb-bewegung')).toContainText('99 000 000 0002 · 1');
    await expect(page.locator('.tb-monat')).toHaveCount(12);

    // Klassen am Stichtag: Kuh (Mutter im Auszug), 2 Färsen, Bulle, Kalb, Jungbulle
    const kl = (k) => page.locator(`#tb-klassen tr[data-klasse="${k}"] td.num`);
    await expect(kl('kuh')).toHaveText(['–', '1', '1', '1,0']);
    await expect(kl('faerse')).toHaveText(['–', '2', '2', '2,0']);
    await expect(kl('m2')).toHaveText(['1', '–', '1', '1,0']);
    await expect(kl('kalb')).toHaveText(['–', '1', '1', '0,3']);
    await expect(kl('m1')).toHaveText(['1', '–', '1', '0,6']);
    await expect(page.locator('#tb-klassen tfoot td.num')).toHaveText(['2', '4', '6', '4,9']);

    // Tierliste mit Filter
    await expect(page.locator('#tb-tiere tbody tr')).toHaveCount(6);
    await page.locator('[data-tb-filter="abgang"]').click();
    await expect(page.locator('#tb-tiere tbody tr')).toHaveCount(3);
    await expect(page.locator('#tb-tiere tbody')).toContainText('Hausschlachtung');
    await page.locator('[data-tb-filter="alle"]').click();
    await page.locator('#tb-search').fill('FR 999');
    await expect(page.locator('#tb-tiere tbody tr')).toHaveCount(1);
  });

  test('Düngung und Tierbesatz: Fläche, 170-kg-Grenze, Mutter- oder Milchkühe', async ({ page }) => {
    await page.goto('/');
    await open(page);
    await page.setInputFiles('#tb-file-empty', await hitPdf(page));
    await expect(page.locator('#tb-content')).toBeVisible({ timeout: 30000 });
    // ohne Fläche: Aufforderung
    await expect(page.locator('#tb-n')).toContainText('Fläche eintragen');
    await page.locator('#tb-lf').fill('10');
    await page.locator('#tb-lf').blur();
    await expect(page.locator('#tb-n')).toHaveClass(/is-ok/);
    await expect(page.locator('#tb-besatz')).toContainText('0,56 GV/ha');
    const n10 = await page.locator('#tb-n .tb-n-value').innerText();
    // knapp bemessene Fläche: Grenze überschritten
    await page.locator('#tb-lf').fill('1,5');
    await page.locator('#tb-lf').blur();
    await expect(page.locator('#tb-n')).toHaveClass(/is-bad/);
    await expect(page.locator('#tb-n')).toContainText('überschritten');
    // Milchkühe: höherer Anfall je Kuh
    await page.locator('#tb-lf').fill('10');
    await page.locator('#tb-lf').blur();
    await page.locator('#tb-kuh').selectOption('milch');
    await expect(page.locator('#tb-n-table tbody')).toContainText('85');
    expect(await page.locator('#tb-n .tb-n-value').innerText()).not.toBe(n10);

    // Fläche aus der Flächenübersicht, wenn Flächen geladen sind
    await page.locator('.segment-btn[data-view="viewer"]').click();
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { SCHLAG_NR: '1', FLAECHE: '25.5' }, geometry: { type: 'Polygon', coordinates: [[[10.4, 51.1], [10.403, 51.1], [10.403, 51.102], [10.4, 51.102], [10.4, 51.1]]] } }] };
    await page.setInputFiles('#file-input', { name: 'f.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });
    await open(page);
    await expect(page.locator('#tb-lf-hint')).toContainText('Flächenübersicht verwenden (25,50 ha)');
    await page.locator('#tb-lf-reset').click();
    await expect(page.locator('#tb-lf')).toHaveValue('25,5');
    await expect(page.locator('#tb-lf-hint')).toHaveText('aus der Flächenübersicht übernommen');
  });

  test('Datenschutz: Kopfdaten des Auszugs werden nicht übernommen; gespeichert je Betrieb', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await page.evaluate(() => { window.__ffTestTk.addEvent({ kunde: 'Hof A' }); window.__ffTestTk.addEvent({ kunde: 'Hof B' }); });
    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof A'));
    await open(page);
    await page.setInputFiles('#tb-file-empty', await hitPdf(page));
    await expect(page.locator('#tb-content')).toBeVisible({ timeout: 30000 });
    await page.evaluate(() => window.__ffTestOffline.persist());
    const stored = JSON.stringify((await page.evaluate(() => window.__ffTestOffline.record())).full.workspaces['Hof A'].tierbestand);
    expect(stored).toContain('DE 99 000 00001');
    for (const s of ['Musterhof', 'Mustermann', 'Musterweg', 'Musterstadt', '0123456789', '99 000 000 0000']) expect(stored).not.toContain(s);
    expect(await page.locator('#tiere-view').innerText()).not.toContain('Mustermann');

    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof B'));
    await expect(page.locator('#tb-empty')).toBeVisible();
    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof A'));
    await expect(page.locator('#tb-content')).toBeVisible();
    await expect(page.locator('#tb-bilanz b').last()).toHaveText('6');

    page.once('dialog', d => d.accept());
    await page.locator('#btn-tb-delete').click();
    await expect(page.locator('#tb-empty')).toBeVisible();
  });

  test('Zuordnung zu Stallabteilen landet im Stallplan und zählt gegen den Bestand', async ({ page }) => {
    await page.goto('/');
    await open(page);
    await page.setInputFiles('#tb-file-empty', await hitPdf(page));
    await expect(page.locator('#tb-content')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#tb-stall')).toContainText('Noch kein Stallplan');

    await page.evaluate(() => window.__ffTestStallplaner.createPlan({
      name: 'Laufstall', gridScale: 1,
      outline: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }] },
      compartments: [{ id: 'abt-1', name: 'Bucht 1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }], tierbestand: [] }]
    }));
    // Ansicht neu öffnen (ein Tipp auf die aktive Kachel führt zur Karte)
    await page.locator('.segment-btn[data-view="viewer"]').click();
    await open(page);
    const row = page.locator('.tb-stall-row[data-tb-abteil="abt-1"]');
    await expect(row).toContainText('Bucht 1');
    await expect(row).toContainText('40.0 m²');
    await expect(page.locator('#tb-stall-sum')).toContainText('0 von 6 Rindern');

    await row.locator('select').selectOption('rind_adult');
    await row.locator('input').fill('4');
    await row.locator('[data-tb-assign]').click();
    await expect(page.locator('#tb-stall-sum')).toContainText('4 von 6 Rindern');
    await expect(page.locator('#tb-stall-sum')).toContainText('2 noch ohne Abteil');
    await expect(row.locator('.tb-stall-chip')).toContainText('4 × Rinder (über 350 kg)');
    await expect(row.locator('.stallplan-badge')).toHaveClass(/ok/); // 4 × 5 m² = 20 von 40 m²
    // steht im Stallplan beim Abteil
    const tb = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().compartments[0].tierbestand.map(x => [x.tierart, x.kategorieId, x.tieranzahl]));
    expect(tb).toEqual([['rinder', 'rind_adult', 4]]);

    // zu viele Tiere: Fläche reicht nicht, mehr zugeordnet als im Bestand
    await row.locator('select').selectOption('rind_adult');
    await row.locator('input').fill('6');
    await row.locator('[data-tb-assign]').click();
    await expect(row.locator('.stallplan-badge')).toHaveClass(/fail/);
    await expect(page.locator('#tb-stall-sum')).toHaveClass(/is-bad/);
    await row.locator('.tb-stall-chip button').last().click();
    await expect(page.locator('#tb-stall-sum')).toContainText('4 von 6 Rindern');
  });

  test('Animationen beim Öffnen: Karten schweben ein, Zahlen zählen hoch, Balken wachsen — nicht bei „weniger Bewegung“', async ({ page }) => {
    await page.goto('/');
    await open(page);
    await page.setInputFiles('#tb-file-empty', await hitPdf(page));
    await expect(page.locator('#tb-content')).toBeVisible({ timeout: 30000 });
    await page.locator('#tb-lf').fill('10');
    await page.locator('#tb-lf').blur();
    const breite = () => page.locator('#tb-n .tb-n-bar span').evaluate(el => el.getBoundingClientRect().width);
    const saeule = () => page.locator('.tb-monat-bars span.is-zu').evaluateAll(els => Math.max(...els.map(e => e.getBoundingClientRect().height)));
    await expect.poll(breite).toBeGreaterThan(20);
    const endBreite = await breite(), endSaeule = await saeule();
    await expect(page.locator('#tiere-view')).not.toHaveClass(/ue-animating/, { timeout: 5000 });

    // Ansicht neu öffnen: startet bei 0 und läuft zum Endwert
    await page.locator('.segment-btn[data-view="viewer"]').click();
    await open(page);
    await expect(page.locator('#tiere-view')).toHaveClass(/ue-animating/);
    expect(await breite()).toBeLessThan(endBreite);
    expect(await saeule()).toBeLessThan(endSaeule);
    expect(await page.locator('#tb-kpis .ue-kpi').first().evaluate(el => getComputedStyle(el).animationName)).toBe('ue-rise');
    await expect.poll(breite).toBeCloseTo(endBreite, 0);
    await expect.poll(saeule).toBeCloseTo(endSaeule, 0);
    await expect(page.locator('#tb-bilanz b')).toHaveText(['7', '2', '3', '6']);
    await expect(page.locator('#tiere-view')).not.toHaveClass(/ue-animating/, { timeout: 5000 });
    // Filter danach blendet nicht erneut ein
    await page.locator('[data-tb-filter="alle"]').click();
    await expect(page.locator('#tiere-view')).not.toHaveClass(/ue-animating/);

    // weniger Bewegung: sofort im Endzustand
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.segment-btn[data-view="viewer"]').click();
    await open(page);
    await expect(page.locator('#tiere-view')).not.toHaveClass(/ue-animating/);
    expect(await breite()).toBeCloseTo(endBreite, 0);
  });

  test('Warenflussprüfung „Bestandsentwicklung Rinder“ als Freitext aus dem Tierbestand', async ({ page }) => {
    await page.goto('/');
    await open(page);
    await page.setInputFiles('#tb-file-empty', await hitPdf(page));
    await expect(page.locator('#tb-content')).toBeVisible({ timeout: 30000 });
    // ohne Anmeldung bzw. ohne Termin: Hinweis statt Prüfung
    await page.locator('#tb-wfp').click();
    await expect(page.locator('#tb-wfp-status')).toContainText('bitte zuerst anmelden');

    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    const id = await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Hof A' }));
    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof A'));
    await page.setInputFiles('#tb-file-empty', await hitPdf(page));
    await expect(page.locator('#tb-content')).toBeVisible({ timeout: 30000 });
    await page.locator('#tb-wfp').click();
    await expect(page.locator('#warenfluss-overlay')).toBeVisible();
    await expect(page.locator('#wf-title')).toHaveText('Warenflussprüfung · Bestandsentwicklung Rinder');
    await expect(page.locator('#wf-zeitraum')).toHaveValue('2025');
    await expect(page.locator('#wf-tol-ertrag')).toBeHidden();

    const ta = page.locator('#wf-text');
    await expect(ta).toBeVisible(); // Freitext ist die Standardansicht
    const text = await ta.inputValue();
    expect(text).toContain('Warenflussprüfung Bestandsentwicklung Rinder — Hof A');
    expect(text).toContain('Bestand zur letzten Jahreskontrolle (01.01.2025): 7 Rinder.');
    expect(text).toContain('– Zugänge: 2 Tiere, davon 1 Geburt im Betrieb und 1 Zukauf/Zugang von einem anderen Betrieb.');
    expect(text).toContain('– Abgänge: 3 Tiere, davon 1 Abgang an einen anderen Betrieb (Verkauf/Abgabe), 1 Verendung und 1 Hausschlachtung.');
    expect(text).toMatch(/– Verluste \(verendet\/tot\): 1 Tier = \d+,\d % des Durchschnittsbestands\./);
    expect(text).toContain('Bestand zum Kontrollzeitpunkt (31.12.2025): 6 Rinder — 1 Kälber bis 6 Monate, 1 Männliche Rinder 1–2 Jahre, 1 Männliche Rinder ab 2 Jahre, 2 Färsen ab 2 Jahre (ohne Kalbung), 1 Kühe (mit Kalbung).');
    expect(text).toContain('Rechnerisch: 7 + 2 − 3 = 6 Tiere. Das entspricht dem Bestand laut HIT zum 31.12.2025');
    expect(text).toContain('Bestand vor Ort am Kontrolltag gezählt: [ ] Tiere');
    expect(text).not.toContain('Mustermann');

    // Tabellen-Ansicht: Kurzübersicht
    await page.locator('#wf-mode [data-mode="tabelle"]').click();
    await expect(page.locator('.wf-bestand tr')).toHaveCount(7); // Anfang, 2 Zugangsarten, 3 Abgangsarten, Ende
    await expect(page.locator('#wf-summary')).toContainText('1 plausibel');
    await page.locator('#wf-done').click();

    // am Termin gespeichert; erneuter Klick öffnet dieselbe Prüfung
    const wf = () => page.evaluate((evId) => (window.__ffTestTk.getEvent(evId).warenfluss || []).map(c => [c.modul, c.zeitraum, c.bestand.endbestand]), id);
    expect(await wf()).toEqual([['bestand', '2025', 6]]);
    await page.locator('#tb-wfp').click();
    await page.locator('#wf-done').click();
    expect(await wf()).toHaveLength(1);
  });

  test('keine HIT-Datei: verständliche Meldung, nichts wird übernommen', async ({ page }) => {
    await page.goto('/');
    await open(page);
    const b64 = await page.evaluate(() => { const d = new window.jspdf.jsPDF(); d.text('Lieferschein Nr. 12', 20, 20); return d.output('datauristring').split(',')[1]; });
    await page.setInputFiles('#tb-file-empty', { name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') });
    await expect(page.locator('#tb-status')).toContainText('kein HIT-Bestandsregister erkannt', { timeout: 30000 });
    await expect(page.locator('#tb-empty')).toBeVisible();
  });
});
