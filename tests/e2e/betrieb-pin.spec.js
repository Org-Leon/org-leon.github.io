import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud } from './helpers.js';

// Gewählter Betrieb erscheint als Pin auf der Karte (Lage aus den Terminen,
// sonst einmal über die Adresse nachgeschlagen).
async function setup(page) {
  await page.route('https://nominatim.openstreetmap.org/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([{ lat: '50.978', lon: '11.029' }])
  }));
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await loginWithCloud(page);
  await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 2);
    window.__ffTestTk.addEvent({ kunde: 'Obsthof Huber GbR', date: d, lat: 51.105, lng: 10.41, address: 'Hauptstr. 1, 99084 Erfurt', geocodeStatus: 'ok' });
    window.__ffTestTk.addEvent({ kunde: 'Biohof Sonnental', date: d, address: 'Talweg 4, 99423 Weimar' });
  });
}
const pin = (page) => page.locator('.leaflet-marker-pane .betrieb-pin');

test.describe('Betrieb als Pin auf der Karte', () => {
  test('Pin mit Namen und Popup, folgt dem Wechsel, verschwindet ohne Betrieb', async ({ page }) => {
    await setup(page);
    await expect(pin(page)).toHaveCount(0);

    await page.evaluate(() => window.__ffTestOffline.switchTo('Obsthof Huber GbR'));
    await expect(pin(page)).toHaveCount(1);
    await expect(pin(page).locator('.betrieb-pin-label')).toHaveText('Obsthof Huber GbR');
    await expect(pin(page).locator('.betrieb-pin-head')).toHaveText('O');
    // Karte war leer -> auf den Betrieb gesprungen
    const c = await page.evaluate(() => window.__ffTestMap.getCenter());
    expect(c.lat).toBeCloseTo(51.105, 2);
    expect(c.lng).toBeCloseTo(10.41, 2);
    await pin(page).click();
    const popup = page.locator('.betrieb-pin-popup');
    await expect(popup).toContainText('Obsthof Huber GbR');
    await expect(popup).toContainText('Hauptstr. 1, 99084 Erfurt');
    await expect(popup.locator('a')).toHaveAttribute('href', /google\.com\/maps/);

    // Betrieb ohne bekannte Lage: Adresse wird nachgeschlagen
    await page.evaluate(() => window.__ffTestOffline.switchTo('Biohof Sonnental'));
    await expect(pin(page)).toHaveCount(1);
    await expect(pin(page).locator('.betrieb-pin-label')).toHaveText('Biohof Sonnental');
    const ll = await page.evaluate(() => {
      let found = null;
      window.__ffTestMap.eachLayer(l => { if (l.options && l.options.title === 'Biohof Sonnental') found = l.getLatLng(); });
      return found;
    });
    expect(ll.lat).toBeCloseTo(50.978, 3);

    // Kein Betrieb -> kein Pin
    await page.evaluate(() => window.__ffTestOffline.switchTo(null));
    await expect(pin(page)).toHaveCount(0);
  });

  test('Manuell angelegter Betrieb ohne Termin: kein Pin', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof ohne Adresse'));
    await expect(page.locator('#btn-betrieb-label')).toContainText('Hof ohne Adresse');
    await expect(pin(page)).toHaveCount(0);
  });
});
