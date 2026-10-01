import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Upload-Warteschlange (Fotos/Dateien am Termin) und Fotomappe (mehrere
// Fotos -> eine PDF). Uploads laufen über window.__ffTestUploadPhotoOverride
// (supabase.js) — hier steuerbar: verzögert, fehlschlagend, erfolgreich.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const photo = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

async function setup(page) {
  await page.goto('/');
  await page.evaluate(() => window.__ffTestTk.loginFake());
  await gotoKontrolleKalender(page);
  const id = await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Hof Upload' }));
  await openFirstTermin(page, 'dokumente');
  return id;
}
// Uploads hängen, bis der Test sie freigibt; mitgeschrieben wird jeder Versuch.
async function holdUploads(page, { failFirst = false } = {}) {
  await page.evaluate((failFirst) => {
    window.__held = [];
    window.__uploaded = [];
    let failed = false;
    window.__ffTestUploadPhotoOverride = (file) => new Promise((resolve, reject) => {
      window.__held.push({
        ok: () => { window.__uploaded.push({ name: file.name, type: file.type, size: file.size }); resolve('test/' + file.name); },
        fail: () => reject(new Error('Netzwerkfehler'))
      });
      if (failFirst && !failed) { failed = true; window.__held.pop().fail(); }
    });
  }, failFirst);
}
const attachmentCount = (page, id) => page.evaluate((evId) => (window.__ffTestTk.getEvent(evId).attachments || []).length, id);

test.describe('Upload-Warteschlange', () => {
  test('Zweites Foto während des ersten Uploads: beide werden hochgeladen, Status sichtbar', async ({ page }) => {
    const id = await setup(page);
    await holdUploads(page);
    await page.setInputFiles('#tk-photo-capture-input', photo('eins.png'));
    await expect(page.locator('#tk-upload-queue .tk-upload')).toHaveCount(1);
    await expect(page.locator('#tk-upload-queue .tk-upload').first()).toHaveClass(/is-uploading/);
    // Während das erste noch läuft, gleich das nächste Foto.
    await page.setInputFiles('#tk-photo-capture-input', photo('zwei.png'));
    await expect(page.locator('#tk-upload-queue .tk-upload')).toHaveCount(2);
    await expect(page.locator('#tk-upload-queue .tk-upload').nth(1)).toContainText('Wartet');
    await expect(page.locator('#tk-upload-queue .tk-upload').nth(1)).toHaveAttribute('title', /In der Warteschlange/);
    await expect(page.locator('#tk-attachments-grid .empty-hint')).toBeHidden();
    await expect(page.locator('#tk-attachment-status')).toContainText('2 Dateien werden hochgeladen');
    await expect(page.locator('#save-status-text')).toHaveText('Lädt hoch · 2');
    await expect(page.locator('#kontrollmappe [data-km-tab="dokumente"] .km-tab-count')).toHaveText('2');
    await expect(page.locator('.tk-card .tk-card-uploading')).toHaveCount(1);

    // Erster fertig -> zweiter startet; beide landen am Termin.
    await page.evaluate(() => window.__held.shift().ok());
    await expect.poll(() => attachmentCount(page, id)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__held.length)).toBe(1);
    await page.evaluate(() => window.__held.shift().ok());
    await expect.poll(() => attachmentCount(page, id)).toBe(2);
    await expect(page.locator('#tk-upload-queue')).toBeHidden();
    await expect(page.locator('#save-status-text')).not.toHaveText(/Lädt hoch/);
    expect(await page.evaluate(() => window.__uploaded.map(u => u.name))).toEqual(['eins.png', 'zwei.png']);
    // Mehrere Dateien auf einmal über "Datei hinzufügen"
    await page.setInputFiles('#tk-file-add-input', [photo('a.png'), photo('b.png'), photo('c.png')]);
    await expect(page.locator('#tk-upload-queue .tk-upload')).toHaveCount(3);
  });

  test('Fehlgeschlagener Upload wird angezeigt und erneut versucht', async ({ page }) => {
    const id = await setup(page);
    await holdUploads(page, { failFirst: true });
    await page.setInputFiles('#tk-photo-capture-input', photo('wackelig.png'));
    const tile = page.locator('#tk-upload-queue .tk-upload');
    await expect(tile).toHaveClass(/is-error/);
    await expect(tile).toContainText('Fehler');
    await expect(tile).toHaveAttribute('title', /Fehlgeschlagen/);
    await expect(page.locator('#tk-attachment-status')).toContainText('Netzwerkfehler');
    // Antippen = sofort neu versuchen
    await tile.click();
    await expect(tile).toHaveClass(/is-uploading/);
    await page.evaluate(() => window.__held.shift().ok());
    await expect.poll(() => attachmentCount(page, id)).toBe(1);
  });

  test('Ohne Netz: Datei bleibt auf dem Gerät (auch nach Neustart) und lädt bei Netz hoch', async ({ page, context }) => {
    const id = await setup(page);
    await page.evaluate(() => {
      window.__uploaded = [];
      window.__ffTestUploadPhotoOverride = async (file) => { window.__uploaded.push(file.name); return 'test/' + file.name; };
    });
    await context.setOffline(true);
    await page.setInputFiles('#tk-photo-capture-input', photo('stall.png'));
    await expect(page.locator('#tk-upload-queue .tk-upload')).toHaveClass(/is-waiting/);
    await expect(page.locator('#tk-upload-queue .tk-upload')).toContainText('Offline');
    await expect(page.locator('#tk-upload-queue .tk-upload')).toHaveAttribute('title', /Wartet auf Internet/);
    await expect(page.locator('#tk-attachment-status')).toContainText('Keine Internetverbindung');
    await expect(page.locator('#save-status-text')).toHaveText('1 Upload wartet');
    await expect.poll(() => page.evaluate(() => window.__ffTestUploads.stored().then(l => l.length))).toBe(1);

    // "Neustart": Warteschlange im Speicher weg, aus IndexedDB wieder aufnehmen.
    await page.evaluate(() => window.__ffTestUploads.clearMemory());
    await page.evaluate(() => window.__ffTestUploads.resume());
    expect(await page.evaluate(() => window.__ffTestUploads.list().length)).toBe(1);

    await context.setOffline(false); // 'online'-Event
    await expect.poll(() => attachmentCount(page, id)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__ffTestUploads.stored().then(l => l.length))).toBe(0);
    expect(await page.evaluate(() => window.__uploaded)).toEqual(['stall.png']);
  });
});

test.describe('Fotomappe', () => {
  test('Mehrere Fotos zu einer PDF: Reihenfolge, Layout, Entwurf bleibt erhalten', async ({ page }) => {
    const id = await setup(page);
    await page.evaluate(() => {
      window.__pdf = null;
      window.__ffTestUploadPhotoOverride = async (file) => {
        const text = new TextDecoder('latin1').decode(new Uint8Array(await file.arrayBuffer()));
        window.__pdf = { name: file.name, type: file.type, pages: (text.match(/\/Type \/Page\b(?!s)/g) || []).length };
        return 'test/' + file.name;
      };
    });
    await page.locator('#tk-fotomappe-btn').click();
    await expect(page.locator('#fotomappe-modal-overlay')).toBeVisible();
    await expect(page.locator('#fotomappe-sub')).toContainText('Hof Upload');
    await expect(page.locator('#fotomappe-create')).toBeDisabled();
    await page.setInputFiles('#fotomappe-pick', [photo('1.png'), photo('2.png'), photo('3.png')]);
    await expect(page.locator('.fotomappe-item')).toHaveCount(3);
    await page.setInputFiles('#fotomappe-capture', photo('4.png'));
    await expect(page.locator('.fotomappe-item')).toHaveCount(4);
    await expect(page.locator('#fotomappe-create-label')).toHaveText('PDF erstellen (4 Fotos, 4 Seiten)');
    await page.locator('#fotomappe-layout [data-per="2"]').click();
    await expect(page.locator('#fotomappe-create-label')).toHaveText('PDF erstellen (4 Fotos, 2 Seiten)');
    // Entfernen + nach vorne schieben
    await page.locator('.fotomappe-item').nth(3).locator('[data-remove]').click();
    await expect(page.locator('.fotomappe-item')).toHaveCount(3);
    const firstId = await page.locator('.fotomappe-item').nth(0).getAttribute('data-id');
    await page.locator('.fotomappe-item').nth(1).locator('[data-move]').click();
    await expect(page.locator('.fotomappe-item').nth(1)).toHaveAttribute('data-id', firstId);

    // Schließen behält den Entwurf
    await page.locator('#fotomappe-close').click();
    await page.locator('#tk-fotomappe-btn').click();
    await expect(page.locator('.fotomappe-item')).toHaveCount(3);
    await expect(page.locator('.fotomappe-item').nth(1)).toHaveAttribute('data-id', firstId);

    await page.locator('#fotomappe-titel').fill('Stall');
    await page.locator('#fotomappe-create').click();
    await expect(page.locator('#fotomappe-modal-overlay')).toBeHidden();
    await expect.poll(() => attachmentCount(page, id)).toBe(1);
    const pdf = await page.evaluate(() => window.__pdf);
    expect(pdf.type).toBe('application/pdf');
    expect(pdf.pages).toBe(2); // 3 Fotos, 2 pro Seite
    const att = await page.evaluate((evId) => window.__ffTestTk.getEvent(evId).attachments[0].name, id);
    expect(att).toMatch(/_Fotomappe Stall\.pdf$/);
    // Entwurf ist nach dem Erstellen leer
    await page.locator('#tk-fotomappe-btn').click();
    await expect(page.locator('.fotomappe-empty')).toBeVisible();
  });
});
