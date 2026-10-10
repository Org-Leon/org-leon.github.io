import { test, expect } from '@playwright/test';

// Flächentabelle der Karte: "Besichtigt" nur angemeldet; am Handy als erste,
// fest stehende Spalte mit großem Haken; Anbauplanung vorerst ausgeblendet.
function file() {
  const fc = { type: 'FeatureCollection', features: [['1', '2.00'], ['2', '3.00'], ['3', '5.00']].map(([nr, ha], i) => {
    const x = 10.40 + i * 0.004, y = 51.105;
    return { type: 'Feature', properties: { SCHLAG_NR: nr, NAME: 'Schlag ' + nr, NUTZ_BEZ: 'Weizen', FLAECHE: ha },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] } };
  }) };
  return { name: 'Schlaege.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) };
}
async function openTable(page) {
  await page.setInputFiles('#file-input', file());
  await page.evaluate(() => document.querySelector('#layer-list [data-action="table"]').click());
  await expect(page.locator('#table-panel')).toHaveClass(/open/);
}
const heads = (page) => page.locator('#feature-table thead th');

test.describe('Flächentabelle', () => {
  test('ohne Anmeldung: kein „Besichtigt", keine Anbauplanung', async ({ page }) => {
    await page.goto('/');
    await openTable(page);
    await expect(heads(page)).toHaveText(['Schlagnr. / Flächennr.', 'Flächenname', 'Flächenidentifikator', 'Größe', 'Kulturart', 'Bäume', 'Notiz', 'Route']);
    await expect(page.locator('#table-besichtigt-summary')).toBeHidden();
    await expect(page.locator('.besichtigt-checkbox')).toHaveCount(0);
    await expect(page.locator('[data-action="kulturplan"]')).toHaveCount(0);
    await expect(page.locator('#feature-table-body tr').first().locator('td')).toHaveCount(8);
  });

  test('angemeldet (PC): Spalte „Besichtigt" mit Zusammenfassung; verschwindet beim Abmelden', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await openTable(page);
    await expect(heads(page)).toHaveText(['Schlagnr. / Flächennr.', 'Flächenname', 'Flächenidentifikator', 'Größe', 'Kulturart', 'Bäume', 'Besichtigt', 'Notiz', 'Route']);
    const sum = page.locator('#table-besichtigt-summary');
    await expect(sum).toContainText('0 / 3');
    await page.locator('#feature-table-body tr').nth(1).locator('.besichtigt-checkbox').check();
    await expect(sum).toContainText('1 / 3');
    await expect(sum).toContainText('3,00 / 10,00');
    await expect(page.locator('#feature-table-body tr').nth(1)).toHaveClass(/is-besichtigt/);
    await expect(sum.locator('.besichtigt-bar > span')).toHaveAttribute('style', /width:\s*33%/);
    // Haken bleibt beim Neuaufbau der Tabelle erhalten
    await page.evaluate(() => window.__ffTestTk.logoutFake());
    await expect(sum).toBeHidden();
    await expect(page.locator('.besichtigt-checkbox')).toHaveCount(0);
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await expect(page.locator('#feature-table-body tr').nth(1).locator('.besichtigt-checkbox')).toBeChecked();
  });

  test('angemeldet (Handy): „Besichtigt" als erste Spalte, großer Haken, ohne seitliches Scrollen erreichbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await openTable(page);
    await expect(page.locator('#feature-table')).toHaveClass(/besichtigt-first/);
    await expect(heads(page).first()).toHaveClass(/besichtigt-cell/);
    await expect(heads(page).nth(1)).toHaveText('Schlagnr. / Flächennr.');
    const mark = page.locator('#feature-table-body tr').first().locator('.besichtigt-mark');
    const box = await mark.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.x).toBeLessThan(60);
    await page.locator('#feature-table-body tr').first().locator('.besichtigt-toggle').click();
    await expect(page.locator('#feature-table-body tr').first()).toHaveClass(/is-besichtigt/);
    await expect(page.locator('#table-besichtigt-summary')).toContainText('1 / 3');
    // Spalte bleibt beim seitlichen Scrollen stehen
    await page.locator('#table-body-wrap').evaluate(el => { el.scrollLeft = 300; });
    const after = await mark.boundingBox();
    expect(Math.abs(after.x - box.x)).toBeLessThan(2);
    // Zeile antippen wählt weiterhin die Fläche, der Haken ändert sich dabei nicht
    await expect(page.locator('#feature-table-body tr').first().locator('.besichtigt-checkbox')).toBeChecked();
  });
});
