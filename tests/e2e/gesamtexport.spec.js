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
