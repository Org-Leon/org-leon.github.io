import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Sicherheits-Regressionen:
// 1. pdf.js 3.x (CVE-2024-4367): jedes getDocument mit isEvalSupported:false
// 2. Dokumentenviewer "In neuem Tab öffnen": nur PDF/Rasterbild, mit festem Typ
//    (blob:-URLs laufen im Ursprung der App — HTML/SVG dürfen dort nie laufen)
// 3. SheetJS 0.20.3 statt 0.18.5 (CVE-2023-30533, CVE-2024-22363), Codepages für alte .xls

// Jeder getDocument-Aufruf wird mitgeschrieben, sobald pdf.js geladen ist.
const PDFJS_SPION = () => {
  window.__pdfAufrufe = [];
  let lib;
  Object.defineProperty(window, 'pdfjsLib', {
    configurable: true,
    get: () => lib,
    set: (v) => {
      // das pdf.js-Objekt ist eingefroren -> Kopie mit mitschreibendem getDocument
      if (v && v.getDocument && !v.__spion) {
        const orig = v.getDocument;
        lib = { ...v, __spion: true, getDocument: (opts) => { window.__pdfAufrufe.push({ isEvalSupported: opts && opts.isEvalSupported }); return orig(opts); } };
      } else lib = v;
    }
  });
};
// window.open mitschreiben statt ein neues Fenster zu öffnen
const OPEN_SPION = () => { window.__geoeffnet = []; window.open = (url) => { window.__geoeffnet.push(url); return null; }; };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>window.top.__xss=1</script><rect width="10" height="10"/></svg>');
const HTML = Buffer.from('<!doctype html><script>window.opener && (window.opener.__xss = 1)</script>');

async function viewerSetup(page, context) {
  await page.addInitScript(PDFJS_SPION);
  await page.addInitScript(OPEN_SPION);
  await page.goto('/');
  const pdfB64 = await page.evaluate(() => { const d = new window.jspdf.jsPDF(); d.text('Test', 20, 20); return d.output('datauristring').split(',')[1]; });
  const files = {
    'p/bericht.pdf': ['application/pdf', Buffer.from(pdfB64, 'base64')],
    'p/foto.png': ['image/png', PNG],
    'p/grafik.svg': ['image/svg+xml', SVG],
    'p/seite.html': ['text/html', HTML]
  };
  await context.route('https://dv.test/**', route => {
    const f = files[decodeURIComponent(new URL(route.request().url()).pathname.slice(1))];
    if (!f) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: f[0], body: f[1], headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.evaluate(() => {
    window.__ffTestTk.loginFake();
    window.__ffTestPhotoUrlOverride = async (path) => 'https://dv.test/' + encodeURIComponent(path);
    window.__ffTestTk.addEvent({
      kunde: 'Hof Sicher',
      attachments: [
        { path: 'p/bericht.pdf', name: 'Bericht.pdf', type: 'application/pdf', size: 3000 },
        { path: 'p/foto.png', name: 'Foto.png', type: 'image/png', size: 70 },
        { path: 'p/grafik.svg', name: 'Grafik.svg', type: 'image/svg+xml', size: 150 },
        { path: 'p/seite.html', name: 'Rechnung.html', type: 'text/html', size: 80 }
      ]
    });
  });
  await gotoKontrolleKalender(page);
  await openFirstTermin(page, 'dokumente');
}
const geoeffneterTyp = (page) => page.evaluate(async () => {
  const url = window.__geoeffnet[window.__geoeffnet.length - 1];
  return url ? { blob: url.startsWith('blob:'), type: (await (await fetch(url)).blob()).type } : null;
});

test.describe('Sicherheit', () => {
  test('Dokumentenviewer: pdf.js ohne eval, neuer Tab nur für PDF/Rasterbild mit festem Typ', async ({ page, context }) => {
    await viewerSetup(page, context);
    const tiles = page.locator('#tk-attachments-grid [data-dv-index]');
    await expect(tiles).toHaveCount(4);
    const open = page.locator('#dv-open');

    // PDF: Vorschau über pdf.js — mit isEvalSupported:false; Öffnen als application/pdf
    await tiles.nth(0).click();
    await expect(page.locator('#dv-pdf canvas').first()).toBeVisible({ timeout: 30000 });
    const aufrufe = await page.evaluate(() => window.__pdfAufrufe);
    expect(aufrufe.length).toBeGreaterThan(0);
    aufrufe.forEach(a => expect(a.isEvalSupported).toBe(false));
    await expect(open).toBeVisible();
    await open.click();
    expect(await geoeffneterTyp(page)).toEqual({ blob: true, type: 'application/pdf' });

    // PNG: darf geöffnet werden
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#dv-name')).toHaveText('Foto.png');
    await expect(open).toBeVisible();
    await open.click();
    expect(await geoeffneterTyp(page)).toEqual({ blob: true, type: 'image/png' });

    // SVG und HTML: kein "In neuem Tab öffnen", nur Herunterladen
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#dv-name')).toHaveText('Grafik.svg');
    await expect(page.locator('#dv-download')).toHaveAttribute('download', 'Grafik.svg');
    await expect(open).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#dv-name')).toHaveText('Rechnung.html');
    await expect(page.locator('#dv-content')).toContainText('keine Vorschau');
    await expect(open).toBeHidden();
    const vorher = await page.evaluate(() => window.__geoeffnet.length);
    await open.evaluate(b => b.click()); // auch erzwungen: nichts wird geöffnet
    expect(await page.evaluate(() => window.__geoeffnet.length)).toBe(vorher);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('HIT-Auszug (Tierbestand): pdf.js ohne eval', async ({ page }) => {
    await page.addInitScript(PDFJS_SPION);
    await page.goto('/');
    const pdfB64 = await page.evaluate(() => { const d = new window.jspdf.jsPDF(); d.text('Kein HIT-Auszug', 20, 20); return d.output('datauristring').split(',')[1]; });
    await page.locator('.segment-btn[data-view="tiere"]').click();
    await page.setInputFiles('#tb-file-empty', { name: 'Auszug.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfB64, 'base64') });
    await expect.poll(() => page.evaluate(() => window.__pdfAufrufe.length), { timeout: 30000 }).toBeGreaterThan(0);
    (await page.evaluate(() => window.__pdfAufrufe)).forEach(a => expect(a.isEvalSupported).toBe(false));
  });

  test('SheetJS: Version 0.20.3, Codepages für alte Dateien (Umlaute in Windows-1252)', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(() => {
      // 'Müllerhof;Gräser' in Windows-1252 (ü = 0xFC, ä = 0xE4) — braucht die Codepage-Tabellen
      const bytes = new Uint8Array([0x4D, 0xFC, 0x6C, 0x6C, 0x65, 0x72, 0x68, 0x6F, 0x66, 0x3B, 0x47, 0x72, 0xE4, 0x73, 0x65, 0x72, 0x0A]);
      const wb = XLSX.read(bytes, { type: 'array', codepage: 1252, FS: ';' });
      return { version: XLSX.version, zeile: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0] };
    });
    expect(r.version).toBe('0.20.3');
    expect(r.zeile).toEqual(['Müllerhof', 'Gräser']);
    // nicht mehr vom cdnjs geladen
    expect(await page.locator('script[src*="xlsx"]').count()).toBe(0);
  });
});
