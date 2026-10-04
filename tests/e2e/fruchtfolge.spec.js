import { test, expect } from '@playwright/test';

// Fruchtfolge: Reiter in der Flächenübersicht (Kennzahlen, Leguminosenanteil
// je Jahr, Hinweise, Tabelle Schlag × Jahr) aus den hinterlegten Jahren des
// Jahresvergleichs; in der Kartenansicht die Option "Kulturen".
// Schlag 1: Getreide 5 Jahre (Weizen 2× in Folge, keine Leguminose)
// Schlag 2: Kleegras 2 Jahre, dann Weizen, Hafer, Ackerbohne — ohne Hinweis
// Schlag 3: Dauergrünland — ohne Hinweis; Schlag 4 erst ab 2024
const JAHRE = {
  2021: [['1', 'Winterweizen', '2.00'], ['2', 'Kleegras', '3.00'], ['3', 'Dauergrünland', '1.00']],
  2022: [['1', 'Winterweizen', '2.00'], ['2', 'Kleegras', '3.00'], ['3', 'Dauergrünland', '1.00']],
  2023: [['1', 'Hafer', '2.00'], ['2', 'Winterweizen', '3.00'], ['3', 'Dauergrünland', '1.00']],
  2024: [['1', 'Dinkel', '2.00'], ['2', 'Hafer', '3.00'], ['3', 'Dauergrünland', '1.00'], ['4', 'Silomais', '1.00']],
  2025: [['1', 'Wintergerste', '2.00'], ['2', 'Ackerbohne', '3.00'], ['3', 'Dauergrünland', '1.00'], ['4', 'Silomais', '1.00']]
};
function yearFile(jahr) {
  const fc = { type: 'FeatureCollection', features: JAHRE[jahr].map(([nr, kultur, ha]) => {
    const x = 10.40 + Number(nr) * 0.004, y = 51.105;
    return { type: 'Feature', properties: { SCHLAG_NR: nr, NAME: 'Schlag ' + nr, NUTZ_BEZ: kultur, FLAECHE: ha, JAHR: String(jahr) },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] } };
  }) };
  return { name: `Antrag_${jahr}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) };
}
const allYears = () => Object.keys(JAHRE).map(j => yearFile(Number(j)));
async function openTab(page) {
  await page.locator('.segment-btn[data-view="uebersicht"]').click();
  await page.locator('#ue-tabs [data-ue-tab="fruchtfolge"]').click();
}
const row = (page, nr) => page.locator(`#ff-table-body tr[data-ff-row="${nr}"]`);
const labels = (page) => page.locator('#map .leaflet-tooltip.feature-label');

test.describe('Fruchtfolge (Flächenübersicht)', () => {
  test('Reiter in der Flächenübersicht statt eigener Kachel; Leerzustand; Jahre hinterlegen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.segment-btn[data-view="fruchtfolge"]')).toHaveCount(0);
    await page.locator('.segment-btn[data-view="uebersicht"]').click();
    await expect(page.locator('#ue-tabs [data-ue-tab="flaechen"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#ue-tab-fruchtfolge')).toBeHidden();
    await page.locator('#ue-tabs [data-ue-tab="fruchtfolge"]').click();
    await expect(page.locator('#ue-tab-flaechen')).toBeHidden();
    await expect(page.locator('#ff-empty')).toBeVisible();
    await page.setInputFiles('#ff-file-add-empty', allYears());
    await expect(page.locator('#ff-empty')).toBeHidden();
    await expect(page.locator('#ff-years-info')).toHaveText('2021 · 2022 · 2023 · 2024 · 2025');
    // dieselben Jahre stehen im Jahresvergleich
    await page.locator('[data-ff-goto-compare]').click();
    await expect(page.locator('.cy-row')).toHaveCount(5);
    // Reiterwahl bleibt beim Zurückkommen erhalten
    await page.locator('.segment-btn[data-view="uebersicht"]').click();
    await expect(page.locator('#ue-tab-fruchtfolge')).toBeVisible();
  });

  test('Kennzahlen, Leguminosen-Säulen (animiert), Hinweise und Tabelle', async ({ page }) => {
    await page.goto('/');
    await openTab(page);
    await page.setInputFiles('#ff-file-add-empty', allYears());

    const kpis = page.locator('#ff-kpis .ue-kpi');
    await expect(kpis).toHaveCount(4);
    await expect(kpis.nth(0)).toContainText('5');
    await expect(kpis.nth(0)).toContainText('2021–2025');
    await expect(kpis.nth(1)).toContainText('7,00 ha in 2025');
    await expect(kpis.nth(2)).toContainText('Leguminosen 2025');
    await expect(kpis.nth(2)).toContainText('3,00 von 6,00 ha Acker');
    await expect(kpis.nth(3)).toHaveClass(/is-warn/);

    // Säulen: Grünland zählt nicht zur Ackerfläche — 2021 3 von 5 ha, 2023 0, 2025 3 von 6 ha
    const col = (j) => page.locator(`.uf-leg-col[data-ff-stat="${j}"]`);
    await expect(page.locator('.uf-leg-col')).toHaveCount(5);
    await expect(col(2021).locator('.uf-leg-val')).toHaveText('60 %');
    await expect(col(2021)).toContainText('3,00 von 5,00 ha');
    await expect(col(2023).locator('.uf-leg-val')).toHaveText('0 %');
    await expect(col(2023)).toHaveClass(/is-zero/);
    await expect(col(2025).locator('.uf-leg-val')).toHaveText('50 %');
    const h = (j) => col(j).locator('.uf-leg-fill').evaluate(el => el.getBoundingClientRect().height);
    const h21 = await h(2021), h25 = await h(2025);
    expect(h21).toBeGreaterThan(100);
    expect(h25 / h21).toBeCloseTo(50 / 60, 1);
    expect(await h(2023)).toBe(0);

    // Beim Öffnen des Reiters animiert: Säulen wachsen von 0, Zahl zählt hoch
    await page.locator('#ue-tabs [data-ue-tab="flaechen"]').click();
    await page.locator('#ue-tabs [data-ue-tab="fruchtfolge"]').click();
    await expect(page.locator('#uebersicht-view')).toHaveClass(/ue-animating/);
    expect(await h(2021)).toBeLessThan(h21);
    await expect(col(2021).locator('.uf-leg-val')).toHaveText('60 %');
    await expect.poll(() => h(2021)).toBeCloseTo(h21, 0);

    // Tabelle
    await expect(page.locator('#ff-table thead th')).toHaveText(['Nr.', 'Name', '2021', '2022', '2023', '2024', '2025', 'Hinweise']);
    await expect(page.locator('#ff-table-body tr')).toHaveCount(4);
    await expect(row(page, 1).locator('.ff-cell')).toHaveText(['Winterweizen', 'Winterweizen', 'Hafer', 'Dinkel', 'Wintergerste']);
    await expect(row(page, 1).locator('.ff-hint-pill')).toHaveText([
      'Winterweizen 2 Jahre in Folge (2021–2022)', '5 Jahre Getreide in Folge (2021–2025)', 'keine Leguminose in 5 Jahren'
    ]);
    await expect(row(page, 2).locator('.ff-hint-pill')).toHaveCount(0); // Kleegras in Folge ist kein Hinweis
    await expect(row(page, 2).locator('.ff-cell.is-leg')).toHaveText(['Kleegras', 'Kleegras', 'Ackerbohne']);
    await expect(row(page, 3).locator('.ff-hint-pill')).toHaveCount(0);
    await expect(row(page, 4).locator('td.ff-none')).toHaveCount(3);
    await expect(row(page, 4).locator('.ff-hint-pill')).toHaveText(['Silomais 2 Jahre in Folge (2024–2025)']);

    await expect(page.locator('#ff-hints')).toContainText('2 Schläge mit Hinweis');
    await expect(page.locator('#ff-hints')).toContainText('2 × gleiche Kultur in Folge');
    await page.locator('#ff-only-hints').check();
    await expect(page.locator('#ff-table-body tr')).toHaveCount(2);
    await expect(page.locator('#ff-table-count')).toHaveText('2');
  });

  test('Karte: Option „Kulturen" färbt nach Kultur eines Jahres, mit Legende', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-kulturen')).toBeHidden(); // ohne hinterlegte Jahre keine Option
    await page.setInputFiles('#file-input', yearFile(2025)); // normale Ebene
    await page.locator('.segment-btn[data-view="compare"]').click();
    await page.setInputFiles('#compare-file-add', allYears());
    await page.locator('.segment-btn[data-view="viewer"]').click();

    const btn = page.locator('#btn-kulturen');
    await expect(btn).toBeVisible();
    await expect(page.locator('#ff-year-toggle')).toBeHidden();
    await expect(page.locator('#ff-map-legend')).toBeHidden();
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    const yearBtns = page.locator('#ff-year-toggle button');
    await expect(yearBtns).toHaveText(['2021', '2022', '2023', '2024', '2025']);
    await expect(yearBtns.last()).toHaveAttribute('aria-checked', 'true');
    await expect(labels(page)).toHaveCount(4);
    await expect(labels(page).filter({ hasText: 'Ackerbohne' })).toHaveCount(1); // Kultur im Label
    await expect(page.locator('#ff-legend-title')).toHaveText('Kulturen 2025');
    await expect(page.locator('#ff-legend')).toContainText('Ackerbohne');

    await yearBtns.first().click();
    await expect(labels(page)).toHaveCount(3);
    await expect(page.locator('#ff-legend-title')).toHaveText('Kulturen 2021');
    await expect(page.locator('#ff-legend')).toContainText('Kleegras');

    // aus: wieder die normale Ebene (Label ohne Kultur)
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#ff-map-legend')).toBeHidden();
    await expect(labels(page)).toHaveCount(4);
    await expect(labels(page).filter({ hasText: 'Schlag 2' })).toHaveCount(1);

    // Funktion wechseln schaltet die Option aus
    await btn.click();
    await page.locator('.segment-btn[data-view="zeichner"]').click();
    await page.locator('.segment-btn[data-view="viewer"]').click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  test('Schlag in der Tabelle antippen: Karte nach Kultur, Popup mit Kulturfolge', async ({ page }) => {
    await page.goto('/');
    await openTab(page);
    await page.setInputFiles('#ff-file-add-empty', allYears());
    await row(page, 4).click();
    await expect(page.locator('#map-wrap')).toBeVisible();
    await expect(page.locator('#btn-kulturen')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#ff-year-toggle button[aria-checked="true"]')).toHaveText('2025');
    await expect(page.locator('.leaflet-popup-content')).toContainText('2024: Silomais');
    await expect(page.locator('.leaflet-popup-content')).toContainText('Silomais 2 Jahre in Folge');
  });

  test('Export als CSV', async ({ page }) => {
    await page.goto('/');
    await openTab(page);
    await page.setInputFiles('#ff-file-add-empty', allYears());
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#ff-export-buttons [data-export="csv"]').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/fruchtfolge_.*\.csv$/);
    const fs = await import('node:fs');
    const text = fs.readFileSync(await download.path(), 'utf8');
    expect(text).toContain('Nummer;Name;2021;2022;2023;2024;2025;Hinweise');
    expect(text).toContain('keine Leguminose in 5 Jahren');
  });
});
