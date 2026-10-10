import { test, expect } from '@playwright/test';

// Frontend-Version ohne Konto und Server (src/edition.js): gebaut mit
// "npm run build:frontend", im Dev-Server per ?edition=frontend einschaltbar.
// Alles, was eine Anmeldung braucht, ist ausgeblendet; die Werkzeuge laufen.
const fc = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { NAME: 'Testacker', KULTUR: 'Hafer' },
    geometry: { type: 'Polygon', coordinates: [[[10.4, 51.1], [10.41, 51.1], [10.41, 51.11], [10.4, 51.11], [10.4, 51.1]]] } }]
};
const WERKZEUGE = ['viewer', 'uebersicht', 'compare', 'zeichner', 'obstbaum', 'bienenflug', 'hofplan', 'stallplaner', 'tiere'];

test.describe('Frontend-Version ohne Konto', () => {
  test('Keine Anmeldung, keine Betriebswahl, kein Dashboard — alle Werkzeuge da, kein Server-Kontakt', async ({ page }) => {
    const fehler = [];
    const server = [];
    page.on('pageerror', e => fehler.push(e.message));
    // fremde Server (nicht die eigenen Quelldateien des Dev-Servers)
    page.on('request', r => { if (/^https?:\/\/[^/]*(supabase\.co|nominatim)/i.test(r.url())) server.push(r.url()); });
    await page.goto('/?edition=frontend');
    await expect(page.locator('html')).toHaveAttribute('data-edition', 'frontend');
    for (const id of ['#btn-account', '#btn-betrieb', '#save-status', '#kontrolle-switcher', '#betrieb-switcher']) {
      await expect(page.locator(id)).toBeHidden();
    }
    await expect(page.locator('#view-switcher .segment-btn').filter({ visible: true })).toHaveCount(WERKZEUGE.length);
    for (const view of WERKZEUGE) {
      await page.locator(`.segment-btn[data-view="${view}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-view', view);
    }
    // nirgends ein Hinweis "bitte anmelden"
    await expect(page.getByText(/anmelden/i).filter({ visible: true })).toHaveCount(0);
    expect(fehler).toEqual([]);
    expect(server).toEqual([]);
  });

  test('Flächentabelle ohne Notiz- und Besichtigt-Spalte; Exporte bleiben', async ({ page }) => {
    await page.goto('/?edition=frontend');
    await page.setInputFiles('#file-input', { name: 'Test.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });
    await expect(page.locator('#layer-section-count')).toHaveText('1');
    await expect(page.locator('#feature-table-body tr')).toHaveCount(1);
    const kopf = await page.locator('#feature-table thead th').allTextContents();
    expect(kopf.join('|')).toContain('Flächenname');
    expect(kopf.join('|')).not.toContain('Notiz');
    expect(kopf.join('|')).not.toContain('Besichtigt');
    await expect(page.locator('.notes-btn')).toHaveCount(0);
    // Export läuft ohne Konto (Flächenliste als Excel)
    await page.locator('.segment-btn[data-view="uebersicht"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-ue-xlsx').click()]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('Verknüpfung auf das Dashboard (?view=kontrolle) landet auf der Karte', async ({ page }) => {
    await page.goto('/?edition=frontend&view=kontrolle');
    await expect(page.locator('#map')).toBeVisible();
    await expect(page.locator('#kontrolle-view')).toBeHidden();
    expect(await page.evaluate(() => document.body.dataset.view || 'viewer')).toBe('viewer');
    // andere Verknüpfungen funktionieren weiter
    await page.goto('/?edition=frontend&view=stallplaner');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'stallplaner');
  });

  test('Ohne den Schalter bleibt die Ausgabe mit Konto unverändert', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-edition', /.+/);
    await expect(page.locator('#btn-account')).toBeVisible();
    await expect(page.locator('#btn-betrieb')).toBeVisible();
  });
});
