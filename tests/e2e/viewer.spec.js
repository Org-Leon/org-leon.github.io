import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Dokumenten- und Fotoviewer (Anhänge am Termin). Dateien kommen über
// window.__ffTestPhotoUrlOverride (supabase.js) von einer Test-Route.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function setup(page, context, { mobile = false } = {}) {
  await page.goto('/');
  // Zweiseitige PDF mit dem jsPDF der App bauen.
  const pdfB64 = await page.evaluate(() => {
    const d = new window.jspdf.jsPDF();
    d.text('Seite eins', 20, 20); d.addPage(); d.text('Seite zwei', 20, 20);
    return d.output('datauristring').split(',')[1];
  });
  const files = { 'p/foto1.png': ['image/png', PNG], 'p/bericht.pdf': ['application/pdf', Buffer.from(pdfB64, 'base64')], 'p/foto2.png': ['image/png', PNG] };
  await context.route('https://dv.test/**', route => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
    const f = files[key];
    if (!f) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: f[0], body: f[1], headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const id = await page.evaluate(() => {
    window.__ffTestTk.loginFake();
    window.__ffTestPhotoUrlOverride = async (path) => 'https://dv.test/' + encodeURIComponent(path);
    return window.__ffTestTk.addEvent({
      kunde: 'Hof Viewer',
      attachments: [
        { path: 'p/foto1.png', name: '2026_Hof Viewer_Foto Termin.png', type: 'image/png', size: 70 },
        { path: 'p/bericht.pdf', name: '2026_Hof Viewer_Scan Termin.pdf', type: 'application/pdf', size: 3000 },
        { path: 'p/foto2.png', name: '2026_Hof Viewer_Foto Termin.png', type: 'image/png', size: 70 }
      ]
    });
  });
  if (mobile) {
    // Am Handy steckt die Funktionswahl in der Schublade.
    await page.locator('#btn-sidebar-toggle').click();
    await page.locator('#kontrolle-switcher').click();
    await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
  } else {
    await gotoKontrolleKalender(page);
  }
  await openFirstTermin(page, 'dokumente');
  return id;
}

test.describe('Dokumenten- und Fotoviewer', () => {
  test('Foto öffnen, zoomen, zu PDF blättern (alle Seiten), Tastatur, schließen', async ({ page, context }) => {
    await setup(page, context);
    const tiles = page.locator('#tk-attachments-grid [data-dv-index]');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(1)).toContainText('picture_as_pdf');
    await tiles.first().click();

    const viewer = page.locator('#docviewer');
    await expect(viewer).toBeVisible();
    await expect(page.locator('#dv-meta')).toContainText('1 / 3');
    await expect(page.locator('#dv-name')).toHaveText('2026_Hof Viewer_Foto Termin.png');
    await expect.poll(() => page.locator('#dv-img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('#dv-download')).toHaveAttribute('download', '2026_Hof Viewer_Foto Termin.png');
    await expect(page.locator('.dv-thumb')).toHaveCount(3);

    // Zoom per Button und Doppelklick zurück
    await page.locator('#dv-zoom-in').click();
    await expect(page.locator('#dv-img')).toHaveClass(/is-zoomed/);
    await page.locator('#dv-img').dblclick();
    await expect(page.locator('#dv-img')).not.toHaveClass(/is-zoomed/);
    await page.locator('#dv-rotate').click();
    await expect.poll(() => page.locator('#dv-img').evaluate(i => i.style.transform)).toContain('rotate(90deg)');

    // Weiter zur PDF: beide Seiten gerendert, Seitenanzeige
    await page.locator('#dv-next').click();
    await expect(page.locator('#dv-meta')).toContainText('2 / 3');
    await expect(page.locator('.dv-pdf-page')).toHaveCount(2, { timeout: 20000 });
    await expect(page.locator('#dv-page')).toHaveText('Seite 1 von 2');
    const w1 = await page.locator('.dv-pdf-page').first().evaluate(c => c.getBoundingClientRect().width);
    await page.locator('#dv-zoom-in').click();
    await expect.poll(() => page.locator('.dv-pdf-page').first().evaluate(c => c.getBoundingClientRect().width)).toBeGreaterThan(w1 + 5);

    // Tastatur: Pfeil rechts, Klick auf Vorschaubild, Esc schließt nur den Viewer
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#dv-meta')).toContainText('3 / 3');
    await page.locator('.dv-thumb').first().click();
    await expect(page.locator('#dv-meta')).toContainText('1 / 3');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(page.locator('#kontrollmappe')).toBeVisible();
  });

  test('Einmal angesehen = auch ohne Internet wieder abrufbar', async ({ page, context }) => {
    await setup(page, context);
    await page.locator('#tk-attachments-grid [data-dv-index]').first().click();
    await expect.poll(() => page.locator('#dv-img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');

    await context.setOffline(true);
    await page.locator('#tk-attachments-grid [data-dv-index]').first().click();
    await expect.poll(() => page.locator('#dv-img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    // Noch nie geöffnete Datei: verständlicher Hinweis statt leerer Seite
    await page.locator('#dv-next').click();
    await expect(page.locator('.dv-message')).toContainText('Keine Internetverbindung');
    await context.setOffline(false);
  });

  test('Noch nicht hochgeladene Datei ansehen und im Viewer verwerfen', async ({ page, context }) => {
    await setup(page, context);
    await page.evaluate(() => { window.__ffTestUploadPhotoOverride = () => new Promise(() => {}); });
    await page.setInputFiles('#tk-file-add-input', [{ name: 'a.png', mimeType: 'image/png', buffer: PNG }, { name: 'b.png', mimeType: 'image/png', buffer: PNG }]);
    await expect(page.locator('#tk-upload-queue .tk-upload')).toHaveCount(2);
    // zweite (wartende) Datei antippen -> Viewer an Position 5 von 5
    await page.locator('#tk-upload-queue .tk-upload').nth(1).click();
    await expect(page.locator('#dv-meta')).toContainText('5 / 5');
    await expect(page.locator('#dv-meta')).toContainText('noch nicht hochgeladen');
    await expect.poll(() => page.locator('#dv-img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    page.once('dialog', d => d.accept());
    await page.locator('#dv-delete').click();
    await expect(page.locator('#dv-meta')).toContainText('4 / 4');
    await page.keyboard.press('Escape');
    await expect(page.locator('#tk-upload-queue .tk-upload')).toHaveCount(1);
  });
});

test.describe('Viewer am Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Vollbild, Wischen blättert', async ({ page, context }) => {
    await setup(page, context, { mobile: true });
    await page.locator('#tk-attachments-grid [data-dv-index]').first().tap();
    const box = await page.locator('#docviewer').boundingBox();
    expect(Math.round(box.width)).toBe(390);
    expect(Math.round(box.height)).toBe(844);
    await expect(page.locator('#dv-meta')).toContainText('1 / 3');
    // Wischen nach links (Pointer-Events wie beim Finger)
    await page.locator('#dv-content').evaluate((el) => {
      const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: 400, bubbles: true, pointerType: 'touch' }));
      ev('pointerdown', 300); ev('pointermove', 200); ev('pointerup', 120);
    });
    await expect(page.locator('#dv-meta')).toContainText('2 / 3');
  });
});
