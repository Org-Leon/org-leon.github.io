import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud, gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Schneller Abgleich zwischen Geräten: Ein Upload auf dem Handy muss ohne den
// 30-s-Takt in der Cloud landen, und ein anderes Gerät holt Neues sofort ab —
// beim Zurückkehren in die App bzw. auf das "es gibt Neues" des Realtime-Kanals.
// Cloud per window.__ffTestCloud gestubbt (siehe helpers.js).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function setup(page) {
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await loginWithCloud(page);
  await gotoKontrolleKalender(page);
  const id = await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Hof Sync' }));
  await page.evaluate(() => window.__ffTestOffline.sync());
  return id;
}
const cloudEvent = (page, id) => page.evaluate((evId) => {
  const row = window.__ffTestCloud.row;
  return row && (row.data.terminkalenderEvents || []).find(e => e.id === evId) || null;
}, id);

test.describe('Schneller Abgleich zwischen Geräten', () => {
  test('Foto-Upload ist nach wenigen Sekunden in der Cloud (nicht erst nach 30 s) und stößt die anderen Geräte an', async ({ page }) => {
    const id = await setup(page);
    await openFirstTermin(page, 'dokumente');
    await page.evaluate(() => { window.__ffTestUploadPhotoOverride = async () => 'test/foto.png'; });
    const gesendetVorher = await page.evaluate(() => window.__ffTestSync.gesendet);
    await page.setInputFiles('#tk-photo-capture-input', { name: 'IMG_1.png', mimeType: 'image/png', buffer: PNG });
    await page.locator('#docname-skip').click();
    await expect.poll(async () => ((await cloudEvent(page, id)) || {}).attachments?.length || 0, { timeout: 5000 }).toBe(1);
    expect(await page.evaluate(() => window.__ffTestSync.gesendet)).toBeGreaterThan(gesendetVorher);
  });

  test('Änderung von einem anderen Gerät: beim Zurückkehren in die App sofort abgeholt', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate((evId) => window.__ffTestCloud.setRemote(d => { d.terminkalenderEvents.find(e => e.id === evId).hinweis = 'Vom Laptop'; }), id);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => page.evaluate((evId) => window.__ffTestTk.getEvent(evId).hinweis, id), { timeout: 4000 }).toBe('Vom Laptop');
  });

  test('"Es gibt Neues" vom anderen Gerät (Realtime-Kanal): sofort abgeholt', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate((evId) => window.__ffTestCloud.setRemote(d => { d.terminkalenderEvents.find(e => e.id === evId).hinweis = 'Vom Handy'; }), id);
    await page.evaluate(() => window.__ffTestSync.ping());
    await expect.poll(() => page.evaluate((evId) => window.__ffTestTk.getEvent(evId).hinweis, id), { timeout: 4000 }).toBe('Vom Handy');
  });
});
