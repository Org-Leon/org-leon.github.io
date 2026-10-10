import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Fotos (Foto aufnehmen) und Anhänge benennen: Dialog nach dem Foto (Datei
// ist da schon gesichert), Vorschläge, Dateinamen-Vorschau, Umbenennen in
// der Warteschlange und am fertigen Anhang. Scanner: siehe scan.spec.js.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const photo = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const YEAR = new Date().getFullYear();

async function setup(page, { hold = false } = {}) {
  await page.goto('/');
  await page.evaluate(() => window.__ffTestTk.loginFake());
  await gotoKontrolleKalender(page);
  const id = await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Hof Upload' }));
  await openFirstTermin(page, 'dokumente');
  await page.evaluate((hold) => {
    window.__held = [];
    window.__ffTestUploadPhotoOverride = (file) => new Promise((resolve) => {
      const ok = () => resolve('test/' + Math.random().toString(36).slice(2) + '.png');
      if (hold) window.__held.push(ok); else ok();
    });
  }, hold);
  return id;
}
const attachments = (page, id) => page.evaluate((evId) => structuredClone(window.__ffTestTk.getEvent(evId).attachments || []), id);
const dlg = (page) => page.locator('#docname-overlay');

test.describe('Dokumente benennen', () => {
  test('Foto aufnehmen: Name mit Vorschlag, Dateinamen-Vorschau, landet am Anhang', async ({ page }) => {
    const id = await setup(page);
    await page.setInputFiles('#tk-photo-capture-input', photo('IMG_0042.png'));
    await expect(dlg(page)).toBeVisible();
    await expect(page.locator('#docname-title')).toHaveText('Foto benennen');
    await expect(page.locator('#docname-preview img')).toBeVisible();
    await expect(page.locator('#docname-input')).toBeFocused();
    await expect(page.locator('#docname-file')).toHaveText(`Dateiname: ${YEAR}_Hof Upload_Foto Termin.png`);

    await page.locator('.docname-chip', { hasText: 'Futtermittel' }).click();
    await expect(page.locator('#docname-input')).toHaveValue('Futtermittel ');
    await page.locator('#docname-input').pressSequentially('Silo Ost');
    await expect(page.locator('#docname-file')).toHaveText(`Dateiname: ${YEAR}_Hof Upload_Futtermittel Silo Ost.png`);
    await page.locator('#docname-input').press('Enter');
    await expect(dlg(page)).toBeHidden();

    await expect.poll(async () => (await attachments(page, id)).map(a => a.name)).toEqual([`${YEAR}_Hof Upload_Futtermittel Silo Ost.png`]);
    await expect(page.locator('#tk-attachments-grid .tk-attachment-link').first()).toHaveAttribute('title', /Futtermittel Silo Ost/);
  });

  test('Während der Upload noch läuft: Name wird übernommen; mehrere Fotos nacheinander benennen', async ({ page }) => {
    const id = await setup(page, { hold: true });
    await page.setInputFiles('#tk-photo-capture-input', photo('a.png'));
    await expect(dlg(page)).toBeVisible();
    // zweites Foto, während der erste Dialog noch offen ist -> wartet
    await page.setInputFiles('#tk-photo-capture-input', photo('b.png'));
    await page.locator('#docname-input').fill('Stall Nord');
    await page.locator('#docname-save').click();
    // Dialog fürs zweite Foto
    await expect(dlg(page)).toBeVisible();
    await expect(page.locator('#docname-input')).toHaveValue('');
    await page.locator('#docname-skip').click();
    await expect(dlg(page)).toBeHidden();

    // Name steht schon in der Warteschlange
    await expect(page.locator('#tk-upload-queue .tk-upload').first()).toHaveAttribute('title', /Stall Nord/);
    await page.evaluate(() => window.__held.shift()());
    await expect.poll(() => page.evaluate(() => window.__held.length)).toBe(1);
    await page.evaluate(() => window.__held.shift()());
    await expect.poll(async () => (await attachments(page, id)).map(a => a.name)).toEqual([
      `${YEAR}_Hof Upload_Stall Nord.png`, `${YEAR}_Hof Upload_Foto Termin.png`
    ]);
  });

  test('Vorhandenen Anhang umbenennen (Abbrechen ändert nichts)', async ({ page }) => {
    const id = await setup(page);
    await page.setInputFiles('#tk-photo-capture-input', photo('x.png'));
    await page.locator('#docname-skip').click();
    await expect.poll(async () => (await attachments(page, id)).length).toBe(1);

    const rename = page.locator('#tk-attachments-grid .tk-attachment-rename').first();
    await rename.click();
    await expect(page.locator('#docname-title')).toHaveText('Dokument umbenennen');
    await expect(page.locator('#docname-input')).toHaveValue('Foto Termin');
    await expect(page.locator('#docname-skip')).toHaveText('Abbrechen');
    await page.locator('#docname-input').fill('Etikett Saatgut');
    await page.keyboard.press('Escape');
    await expect(dlg(page)).toBeHidden();
    expect((await attachments(page, id))[0].name).toBe(`${YEAR}_Hof Upload_Foto Termin.png`);
    await expect(page.locator('#kontrollmappe')).toBeVisible(); // Escape schließt nur den Dialog

    await page.locator('#tk-attachments-grid .tk-attachment-rename').first().click();
    await page.locator('#docname-input').fill('Etikett / Saatgut');
    await page.locator('#docname-save').click();
    await expect.poll(async () => (await attachments(page, id))[0].name).toBe(`${YEAR}_Hof Upload_Etikett - Saatgut.png`);
    await expect(page.locator('#tk-attachments-grid .tk-attachment-link').first()).toHaveAttribute('title', /Etikett - Saatgut/);
  });
});
