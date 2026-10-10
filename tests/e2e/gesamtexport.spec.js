import { test, expect } from '@playwright/test';
import { gotoTab, drawZeichnerPolygon, drawHofplanRect, TEST_POLY_A, TEST_RECT_A } from './helpers.js';

test.describe('Gesamtexport', () => {
  test('Buttons zeigen einen Fehler, wenn noch nichts angelegt wurde', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-export-gesamt-geojson').click();
    await expect(page.locator('#error-toast')).toBeVisible();
  });

  test('Alles als GeoJSON exportieren enthält alle Quellen mit korrektem Tag', async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Flächenzeichner');
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await gotoTab(page, 'Hofplan');
    await drawHofplanRect(page, TEST_RECT_A);
    // Erneuter Klick auf den bereits aktiven Tab schaltet laut setActiveSegment()
    // zurück auf den Viewer, wo die Gesamtexport-Buttons liegen.
    await page.locator('.segment-btn.active').click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-export-gesamt-geojson').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/FeldFolio.*\.geojson$/);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const fc = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    expect(fc.type).toBe('FeatureCollection');
    const quellen = fc.features.map((f) => f.properties.quelle).sort();
    expect(quellen).toEqual(['Flächenzeichner', 'Hofplan']);
  });

  // Neue Gesamtübersicht (src/gesamtbericht.js + exportKombiniertesPDF):
  // Flächen aus Shapedateien UND Flächenzeichner in Übersicht/Tabelle,
  // Kulturen summiert, Flächenkarten nur für gezeichnete Flächen, dazu
  // Obstbaum (mit Flächenbezug), Bienenflug und Hofplan.
  test('Gesamtübersicht: Shapedatei + gezeichnete Flächen, Kulturen summiert, alle Abschnitte', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    const fc = { type: 'FeatureCollection', features: [] };
    [['Winterweizen', '2.50'], ['Winterweizen', '1.50'], ['Silomais', '3.00'], ['', '']].forEach(([kultur, ha], i) => {
      const x = 10.40 + i * 0.004, y = 51.105;
      fc.features.push({
        type: 'Feature',
        properties: { SCHLAG_NR: String(i + 1), NAME: 'Schlag ' + (i + 1), NUTZ_BEZ: kultur, FLAECHE: ha },
        geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] }
      });
    });
    await page.setInputFiles('#file-input', { name: 'Schlaege.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });
    await expect(page.locator('#layer-list .layer-item')).toHaveCount(1);

    await gotoTab(page, 'Flächenzeichner');
    await drawZeichnerPolygon(page, [[51.101, 10.401], [51.101, 10.405], [51.103, 10.405], [51.103, 10.401]]);
    await gotoTab(page, 'Obstbaumkataster');
    await page.evaluate(() => {
      document.querySelector('.fruit-btn').click();
      // zwei Bäume in Schlag 1, einer ohne Fläche
      [[51.1058, 10.4012], [51.1062, 10.4018], [51.090, 10.39]].forEach(([lat, lng]) => window.__ffTestMap.fire('click', { latlng: window.L.latLng(lat, lng) }));
    });
    await gotoTab(page, 'Bienenflugkarte');
    await page.evaluate(() => window.__ffTestMap.fire('click', { latlng: window.L.latLng(51.108, 10.41) }));
    await gotoTab(page, 'Hofplan');
    await drawHofplanRect(page, TEST_RECT_A);
    await page.locator('.segment-btn[data-view="viewer"]').click();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 110000 }),
      page.locator('#btn-export-gesamt-pdf').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/FeldFolio.*Gesamt.*\.pdf$/);
    const r = await page.evaluate(() => window.__ffTestLastGesamt);

    expect(r.sections).toEqual(['Flächenübersicht', 'Flächenliste', 'Flächenkarten (Flächenzeichner)', 'Obstbaumkataster', 'Bienenflugkarte', 'Hofplan']);
    // 4 Flächen aus der Shapedatei + 1 gezeichnete
    expect(r.rows).toHaveLength(5);
    expect(r.rows.filter(x => x.quelle === 'Gezeichnet')).toHaveLength(1);
    // Größen: Attribut, wo vorhanden — sonst aus der Geometrie berechnet
    expect(r.rows.find(x => x.nummer === '1' && x.quelle !== 'Gezeichnet').ha).toBeCloseTo(2.5, 5);
    expect(r.rows.find(x => x.nummer === '4').computed).toBe(true);
    // Kulturen summiert (Winterweizen 2,5 + 1,5)
    const weizen = r.kulturen.find(k => k.label === 'Winterweizen');
    expect(weizen.value).toBeCloseTo(4, 5);
    expect(weizen.count).toBe(2);
    expect(r.kulturen.some(k => k.label === 'Ohne Angabe')).toBe(true);
    expect(r.totalHa).toBeCloseTo(r.rows.reduce((s, x) => s + x.ha, 0), 5);
    // Bäume je Fläche verknüpft
    expect(r.rows.find(x => x.nummer === '1' && x.quelle !== 'Gezeichnet').trees).toBe(2);
    // Kartenseiten: 1 Flächenkarte (nur Flächenzeichner) + 2 Obstbaum (Fläche, ohne Fläche) + 1 Bienenstock + 1 Hofplan
    expect(r.mapPages).toBe(5);
    // Deckblatt + Übersicht + Liste + 1 Karte + Obstbaum-Übersicht + 2 Obstbaum-Karten + Bienenflug + Hofplan
    expect(r.pages).toBe(9);
    // Karte danach wieder im Ausgangszustand (Ebenen sichtbar)
    await expect(page.locator('.leaflet-control-zoom')).toHaveCount(1);
  });

  test('Gesamtübersicht als PDF exportieren liefert eine nicht-leere PDF-Datei', async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Flächenzeichner');
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await page.locator('.segment-btn.active').click();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('#btn-export-gesamt-pdf').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/FeldFolio.*\.pdf$/);
    const path = await download.path();
    expect(path).toBeTruthy();
  });
});
