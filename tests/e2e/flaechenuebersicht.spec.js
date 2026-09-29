import { test, expect } from '@playwright/test';
import { gotoTab, drawZeichnerPolygon } from './helpers.js';

// Flächenübersicht (eigene Ansicht, src/flaechenuebersicht.js): gleiche
// Zahlen wie die Gesamtübersicht, Kultur-Filter, Suche, Sortierung, Sprung
// zur Karte, Excel-Export, Animationen nur beim Öffnen.
const KULTUREN = [['Winterweizen', '2.50'], ['Winterweizen', '1.50'], ['Silomais', '3.00'], ['', '0.80']];

async function loadShapefile(page, name = 'Schlaege.geojson', list = KULTUREN, x0 = 10.40) {
  const fc = { type: 'FeatureCollection', features: list.map(([kultur, ha], i) => {
    const x = x0 + i * 0.004, y = 51.105;
    return { type: 'Feature', properties: { SCHLAG_NR: String(i + 1), NAME: 'Schlag ' + (i + 1), NUTZ_BEZ: kultur, FLAECHE: ha },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] } };
  }) };
  await page.setInputFiles('#file-input', { name, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });
}
const openUebersicht = (page) => page.locator('.segment-btn[data-view="uebersicht"]').click();

test.describe('Flächenübersicht', () => {
  test('Ohne Flächen: freundlicher Leerzustand mit Weg zum Flächenzeichner', async ({ page }) => {
    await page.goto('/');
    await openUebersicht(page);
    await expect(page.locator('#uebersicht-view')).toBeVisible();
    await expect(page.locator('#map-wrap')).toBeHidden();
    await expect(page.locator('#ue-empty')).toBeVisible();
    await page.locator('#ue-empty [data-goto="zeichner"]').click();
    await expect(page.locator('.segment-btn[data-view="zeichner"]')).toHaveClass(/active/);
  });

  test('Kennzahlen, Kulturarten und Tabelle stimmen mit den Daten überein', async ({ page }) => {
    await page.goto('/');
    await loadShapefile(page);
    await openUebersicht(page);
    const kpis = page.locator('#ue-kpis .ue-count');
    await expect(kpis.nth(0)).toHaveText('7,80', { timeout: 5000 }); // 2,5 + 1,5 + 3 + 0,8 (nach dem Hochzählen)
    await expect(kpis.nth(1)).toHaveText('2');                          // Winterweizen, Silomais
    await expect(page.locator('#ue-kpis')).toContainText('größte: Winterweizen');
    await expect(page.locator('.ue-bar-row')).toHaveCount(3);          // inkl. "Ohne Angabe"
    await expect(page.locator('.ue-bar-row').first()).toContainText('Winterweizen');
    await expect(page.locator('.ue-bar-row').first()).toContainText('4,00 ha');
    await expect(page.locator('.ue-donut-seg')).toHaveCount(3);
    await expect(page.locator('#ue-table tbody tr')).toHaveCount(4);
    await expect(page.locator('#ue-table tfoot')).toContainText('7,80');
    await expect(page.locator('#ue-top .ue-top-item').first()).toContainText('3,00 ha');
  });

  test('Kultur antippen filtert die Tabelle, Suche und Sortierung wirken', async ({ page }) => {
    await page.goto('/');
    await loadShapefile(page);
    await openUebersicht(page);
    await page.locator('.ue-bar-row', { hasText: 'Winterweizen' }).click();
    await expect(page.locator('#ue-filter')).toBeVisible();
    await expect(page.locator('#ue-table tbody tr')).toHaveCount(2);
    await expect(page.locator('#ue-table tfoot')).toContainText('2 Flächen von 4');
    // Filter-Chip hebt den Filter wieder auf
    await page.locator('#ue-filter').click();
    await expect(page.locator('#ue-table tbody tr')).toHaveCount(4);
    // Suche
    await page.locator('#ue-search').fill('silo');
    await expect(page.locator('#ue-table tbody tr')).toHaveCount(1);
    await page.locator('#ue-search').fill('');
    // Sortierung: Standard Größe absteigend, Klick auf Name -> A–Z
    await expect(page.locator('#ue-table tbody tr').first()).toContainText('Schlag 3');
    await page.locator('#ue-table thead [data-sort="name"]').click();
    await expect(page.locator('#ue-table tbody tr').first()).toContainText('Schlag 1');
  });

  test('Fläche antippen springt zur Karte', async ({ page }) => {
    await page.goto('/');
    await loadShapefile(page);
    await openUebersicht(page);
    await page.locator('#ue-table tbody tr').first().click();
    await expect(page.locator('.segment-btn[data-view="viewer"]')).toHaveClass(/active/);
    await expect(page.locator('#map-wrap')).toBeVisible();
    await expect(page.locator('#uebersicht-view')).toBeHidden();
  });

  test('Neue Daten bei offener Übersicht erscheinen sofort, gezeichnete Flächen zählen mit', async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Flächenzeichner');
    await drawZeichnerPolygon(page, [[51.101, 10.401], [51.101, 10.405], [51.103, 10.405], [51.103, 10.401]]);
    await openUebersicht(page);
    await expect(page.locator('#ue-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#ue-table tbody')).toContainText('Gezeichnet');
    await loadShapefile(page);
    await expect(page.locator('#ue-table tbody tr')).toHaveCount(5);
  });

  test('Flächenliste als Excel exportieren', async ({ page }) => {
    await page.goto('/');
    await loadShapefile(page);
    await openUebersicht(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-ue-xlsx').click()]);
    expect(download.suggestedFilename()).toMatch(/Fl(ä|ae)chenliste.*\.xlsx$/);
  });

  test('Animationen beim Öffnen — bei "weniger Bewegung" sofort im Endzustand', async ({ page }) => {
    await page.goto('/');
    await loadShapefile(page);
    await openUebersicht(page);
    await expect(page.locator('#uebersicht-view')).toHaveClass(/ue-animating/);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.segment-btn[data-view="viewer"]').click();
    await openUebersicht(page);
    await expect(page.locator('#uebersicht-view')).not.toHaveClass(/ue-animating/);
    // Zahl steht sofort (ohne Hochzählen) auf dem Endwert
    expect(await page.locator('#ue-kpis .ue-count').first().textContent()).toBe('7,80');
  });
});
