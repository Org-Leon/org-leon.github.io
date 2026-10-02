import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud } from './helpers.js';

// Jahresvergleich über mehrere Jahre: Shape-Dateien je Jahr hinterlegen
// (gespeichert beim Betrieb), zwei Jahre vergleichen, über der Karte je Jahr
// ein Knopf mit der Jahreszahl.
const JAHRE = {
  2023: [['1', 'Weizen', '2.00'], ['2', 'Mais', '1.50']],
  2024: [['1', 'Weizen', '2.00'], ['2', 'Gerste', '1.50'], ['3', 'Raps', '1.00']],
  2025: [['1', 'Weizen', '2.20'], ['3', 'Raps', '1.00'], ['4', 'Hafer', '0.80']]
};
function yearFile(jahr, { withYear = true, name } = {}) {
  const fc = { type: 'FeatureCollection', features: JAHRE[jahr].map(([nr, kultur, ha]) => {
    const x = 10.40 + Number(nr) * 0.004, y = 51.105;
    return { type: 'Feature', properties: { SCHLAG_NR: nr, NAME: 'Schlag ' + nr, NUTZ_BEZ: kultur, FLAECHE: ha, ...(withYear ? { JAHR: String(jahr) } : {}) },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] } };
  }) };
  return { name: name || `Antrag_${withYear ? jahr : 'ohne'}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) };
}
const openCompare = (page) => page.locator('.segment-btn[data-view="compare"]').click();
const toggleBtns = (page) => page.locator('#compare-view-toggle .cvt-btn');
const labelCount = (page) => page.locator('#map .leaflet-tooltip.feature-label').count();

test.describe('Jahresvergleich (mehrere Jahre)', () => {
  test('drei Jahre hinterlegen, Jahreszahlen über der Karte, vergleichen und Paar wechseln', async ({ page }) => {
    await page.goto('/');
    await openCompare(page);
    await expect(page.locator('#compare-years .cy-empty')).toBeVisible();
    await page.setInputFiles('#compare-file-add', [yearFile(2025), yearFile(2023), yearFile(2024)]);

    // Liste nach Jahr sortiert, mit Flächen/ha
    await expect(page.locator('.cy-row')).toHaveCount(3);
    await expect.poll(() => page.locator('.cy-row .cy-jahr').evaluateAll(els => els.map(e => e.value))).toEqual(['2023', '2024', '2025']);
    await expect(page.locator('.cy-row').first()).toContainText('2 Flächen · 3,50 ha');

    // Über der Karte: Vergleich + Jahreszahlen, keine "Jahr A/B" mehr
    await expect(toggleBtns(page)).toHaveText(['Vergleich', '2023', '2024', '2025']);
    await expect(toggleBtns(page).first()).toBeDisabled();
    await expect(page.locator('#compare-view-toggle')).not.toContainText('Jahr A');

    // Standard: die beiden neuesten Jahre
    await expect(page.locator('#compare-sel-a')).toHaveValue(await page.locator('.cy-row').nth(1).getAttribute('data-cy'));
    await expect(page.locator('#compare-sel-b option:checked')).toHaveText('2025');
    await page.locator('#btn-compare-run').click();
    await expect(page.locator('#compare-summary')).toContainText('1Zugänge');
    await expect(page.locator('#compare-summary')).toContainText('1Abgänge');
    await expect(page.locator('#compare-summary')).toContainText('1Verändert');
    await expect(toggleBtns(page).first()).toHaveText('2024 → 2025');
    await expect(toggleBtns(page).first()).toHaveClass(/active/);
    await expect(page.locator('#compare-th-a')).toHaveText('Größe 2024');
    await expect(page.locator('#compare-th-kultur')).toHaveText('Kultur 2024 → 2025');

    // Nur ein Jahr: 2025 (im Vergleich) bzw. 2023 (außerhalb, neutral)
    await toggleBtns(page).filter({ hasText: /^2025$/ }).click();
    await expect(toggleBtns(page).filter({ hasText: /^2025$/ })).toHaveClass(/active/);
    await expect.poll(() => labelCount(page)).toBe(3);
    await toggleBtns(page).filter({ hasText: /^2023$/ }).click();
    await expect.poll(() => labelCount(page)).toBe(2);
    await toggleBtns(page).first().click();
    await expect.poll(() => labelCount(page)).toBe(4);

    // Paar wechseln -> sofort neu verglichen
    await page.locator('#compare-sel-a').selectOption({ label: '2023' });
    await expect(toggleBtns(page).first()).toHaveText('2023 → 2025');
    await expect(page.locator('#compare-summary')).toContainText('2Zugänge');
  });

  test('ohne erkennbares Jahr: eintragen; doppeltes Jahr ersetzen; Jahr entfernen', async ({ page }) => {
    await page.goto('/');
    await openCompare(page);
    await page.setInputFiles('#compare-file-add', yearFile(2024, { withYear: false }));
    const row = page.locator('.cy-row');
    await expect(row).toHaveClass(/is-missing/);
    await expect(row).toContainText('Jahr eintragen');
    await expect(row.locator('.cy-jahr')).toBeFocused();
    await expect(toggleBtns(page)).toHaveCount(1); // nur "Vergleich"
    await row.locator('.cy-jahr').fill('20');
    await row.locator('.cy-jahr').press('Enter');
    await row.locator('.cy-jahr').blur();
    await expect(page.locator('#compare-status')).toContainText('Bitte ein Jahr');
    await row.locator('.cy-jahr').fill('2024');
    await row.locator('.cy-jahr').blur();
    await expect(row).not.toHaveClass(/is-missing/);
    await expect(toggleBtns(page)).toHaveText(['Vergleich', '2024']);

    // gleiches Jahr erneut -> Rückfrage, ersetzen
    page.once('dialog', d => d.accept());
    await page.setInputFiles('#compare-file-add', yearFile(2024, { name: 'Antrag_2024_neu.geojson' }));
    await expect(page.locator('.cy-row')).toHaveCount(1);
    await expect(page.locator('.cy-row .cy-file')).toHaveText('Antrag_2024_neu.geojson');

    page.once('dialog', d => d.accept());
    await page.locator('.cy-row .cy-del').click();
    await expect(page.locator('.cy-row')).toHaveCount(0);
    await expect(page.locator('#btn-compare-run')).toBeDisabled();
  });

  test('geladene Kartenebene als Jahr übernehmen', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file-input', yearFile(2025));
    await openCompare(page);
    await expect(page.locator('#compare-layer-pick')).toBeVisible();
    await page.locator('#compare-layer-add').click();
    await expect(page.locator('.cy-row .cy-jahr')).toHaveValue('2025');
  });

  test('hinterlegte Jahre bleiben beim Betrieb gespeichert', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await page.evaluate(() => { window.__ffTestTk.addEvent({ kunde: 'Hof A' }); window.__ffTestTk.addEvent({ kunde: 'Hof B' }); });
    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof A'));
    await openCompare(page);
    await page.setInputFiles('#compare-file-add', [yearFile(2023), yearFile(2024)]);
    await expect(page.locator('.cy-row')).toHaveCount(2);

    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof B'));
    await expect(page.locator('.cy-row')).toHaveCount(0);
    await expect(toggleBtns(page)).toHaveCount(1);

    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof A'));
    await expect.poll(() => page.locator('.cy-row .cy-jahr').evaluateAll(els => els.map(e => e.value))).toEqual(['2023', '2024']);
    await expect(toggleBtns(page)).toHaveText(['Vergleich', '2023', '2024']);
    await page.locator('#btn-compare-run').click();
    await expect(page.locator('#compare-summary')).toContainText('1Zugänge');
  });
});
