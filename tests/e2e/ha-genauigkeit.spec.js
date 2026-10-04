import { test, expect } from '@playwright/test';
import { gotoTab, drawZeichnerPolygon } from './helpers.js';

// Hektar-Angaben: Einzelflächen mit Größe aus der Shapedatei bis zu vier
// Nachkommastellen (qm-genau), mindestens zwei. Summen/Kennzahlen und aus
// der Geometrie berechnete Größen bleiben bei zwei Stellen. Im
// Jahresvergleich gilt "verändert" weiterhin erst ab 0,01 ha.
function file(name, list, jahr) {
  const fc = { type: 'FeatureCollection', features: list.map(([nr, ha], i) => {
    const x = 10.40 + i * 0.004, y = 51.105;
    return { type: 'Feature', properties: { SCHLAG_NR: nr, NAME: 'Schlag ' + nr, NUTZ_BEZ: 'Weizen', ...(ha != null ? { FLAECHE: ha } : {}), ...(jahr ? { JAHR: String(jahr) } : {}) },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] } };
  }) };
  return { name, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) };
}

test.describe('Hektar auf den Quadratmeter genau', () => {
  test('Flächenübersicht: Einzelflächen bis 4 Stellen, berechnete und Summen 2 Stellen', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', file('Schlaege.geojson', [['1', '2.3471'], ['2', '1.5'], ['3', '0.80005'], ['4', null]]));
    await page.locator('.segment-btn[data-view="uebersicht"]').click();
    const cell = (nr) => page.locator('#ue-table tbody tr', { hasText: 'Schlag ' + nr }).locator('td.num').last();
    await expect(cell(1)).toHaveText('2,3471');
    await expect(cell(2)).toHaveText('1,50');      // mindestens zwei Stellen
    await expect(cell(3)).toHaveText('0,8001');    // höchstens vier (gerundet)
    await expect(cell(4)).toHaveText(/^\d+,\d{2}\*$/); // aus der Geometrie berechnet: zwei Stellen + Stern
    await expect(page.locator('#ue-table tfoot td.num')).toHaveText(/^\d+,\d{2}$/);
    await expect(page.locator('#ue-top')).toContainText('2,3471 ha');
    await expect(page.locator('#ue-donut-value')).toHaveText(/^\d+,\d{2}$/);
  });

  test('Karte: Flächentabelle zeigt die genaue Größe; gezeichnete Flächen bleiben bei zwei Stellen', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', file('Schlaege.geojson', [['1', '2.3471']]));
    await page.locator('#layer-list [data-action="table"]').click();
    await expect(page.locator('#feature-table-body')).toContainText('2,3471 ha');
    await gotoTab(page, 'Flächenzeichner');
    await drawZeichnerPolygon(page, [[51.10, 10.40], [51.10, 10.4017], [51.1011, 10.4017], [51.1011, 10.40]]);
    await expect(page.locator('#zeichner-list .parcel-size')).toHaveText(/^\d+,\d{2} ha$/);
  });

  test('Jahresvergleich: genaue Größen und Differenz; unter 0,01 ha bleibt „unverändert"', async ({ page }) => {
    await page.goto('/');
    await page.locator('.segment-btn[data-view="compare"]').click();
    await page.setInputFiles('#compare-file-add', [
      file('A_2024.geojson', [['1', '2.3471'], ['2', '1.2000']], 2024),
      file('A_2025.geojson', [['1', '2.3596'], ['2', '1.2050']], 2025)
    ]);
    await page.locator('#btn-compare-run').click();
    const row = (nr) => page.locator('#compare-table-body tr', { hasText: 'Schlag ' + nr });
    await expect(row(1)).toContainText('Verändert');
    await expect(row(1).locator('td').nth(3)).toHaveText('2,3471');
    await expect(row(1).locator('td').nth(4)).toHaveText('2,3596');
    await expect(row(1).locator('td').nth(5)).toHaveText('+0,0125');
    // 0,005 ha Unterschied: sichtbar, aber unter der Schwelle von 0,01 ha
    await expect(row(2)).toContainText('Unverändert');
    await expect(row(2).locator('td').nth(3)).toHaveText('1,20');
    await expect(row(2).locator('td').nth(4)).toHaveText('1,205');
    await expect(row(2).locator('td').nth(5)).toHaveText('+0,005');
  });
});
