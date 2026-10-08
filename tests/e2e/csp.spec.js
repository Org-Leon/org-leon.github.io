import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Content-Security-Policy (vite.config.js, cspPlugin): die Seite darf nur von
// den dort erlaubten Quellen laden. Dieser Test klickt durch die Ansichten und
// die nachgeladenen Bibliotheken (pdf.js, OpenCV) und meldet jeden Verstoß —
// fehlt eine Quelle in der Policy, schlägt er fehl, statt dass die Funktion
// still kaputt ist.
const SAMMLER = () => {
  window.__cspVerstoesse = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspVerstoesse.push(`${e.effectiveDirective} blockiert ${e.blockedURI || 'inline'}${e.sourceFile ? ' (' + e.sourceFile.split('/').pop() + ':' + e.lineNumber + ')' : ''}`);
  });
};
const verstoesse = (page) => page.evaluate(() => window.__cspVerstoesse);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test.describe('Content-Security-Policy', () => {
  test('Policy ist gesetzt: keine fremden Skriptquellen, kein unsafe-inline/unsafe-eval für Skripte', async ({ page }) => {
    await page.goto('/');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    const teil = (name) => (csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) || '').split(' ').slice(1);
    expect(teil('default-src')).toEqual(["'self'"]);
    const skripte = teil('script-src');
    expect(skripte).not.toContain("'unsafe-inline'");
    expect(skripte).not.toContain("'unsafe-eval'");
    // fremde Skripte nur als einzelne Dateien bzw. Versionsordner von cdnjs — nie der ganze Host
    const fremd = skripte.filter(s => s.startsWith('http'));
    expect(fremd.length).toBeGreaterThan(5);
    fremd.forEach(s => expect(s).toMatch(/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/[^/]+\/[^/]+\/.*/));
    expect(teil('base-uri')).toEqual(["'self'"]);
    // alle fest eingebundenen CDN-Dateien tragen eine Prüfsumme
    const ohne = await page.evaluate(() => [...document.querySelectorAll('script[src^="https://"], link[rel="stylesheet"][href^="https://cdnjs"]')]
      .filter(el => !el.integrity).map(el => el.src || el.href));
    expect(ohne).toEqual([]);
  });

  test('Alle Ansichten, Karten, Konto, Viewer mit pdf.js: kein Verstoß', async ({ page, context }) => {
    await page.addInitScript(SAMMLER);
    await page.goto('/');
    // eingebettetes Theme-Skript läuft (per Prüfsumme erlaubt)
    await page.evaluate(() => localStorage.setItem('oekoviewer-theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const pdfB64 = await page.evaluate(() => { const d = new window.jspdf.jsPDF(); d.text('Test', 20, 20); return d.output('datauristring').split(',')[1]; });
    await context.route('https://dv.test/**', route => {
      const pdf = route.request().url().endsWith('.pdf');
      route.fulfill({ status: 200, contentType: pdf ? 'application/pdf' : 'image/png', body: pdf ? Buffer.from(pdfB64, 'base64') : PNG, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    for (const view of ['viewer', 'uebersicht', 'compare', 'zeichner', 'obstbaum', 'bienenflug', 'hofplan', 'stallplaner', 'tiere']) {
      await page.locator(`.segment-btn[data-view="${view}"]`).click();
    }
    // Basiskarten (Kacheln von OSM, OpenTopoMap, Esri)
    await page.locator('.segment-btn[data-view="viewer"]').click();
    for (const karte of ['topo', 'satellite', 'osm']) await page.locator(`#basemap-seg [data-basemap="${karte}"]`).click({ force: true });
    // Konto-Dialog
    await page.locator('#btn-account').click();
    await page.keyboard.press('Escape');
    // Kontrolle + Dokumentenviewer (Foto, PDF über pdf.js mit geprüftem Worker)
    await page.evaluate(() => {
      window.__ffTestTk.loginFake();
      window.__ffTestPhotoUrlOverride = async (path) => 'https://dv.test/' + encodeURIComponent(path);
      window.__ffTestTk.addEvent({ kunde: 'Hof CSP', attachments: [
        { path: 'p/foto.png', name: 'Foto.png', type: 'image/png', size: 70 },
        { path: 'p/bericht.pdf', name: 'Bericht.pdf', type: 'application/pdf', size: 3000 }] });
    });
    await gotoKontrolleKalender(page);
    await openFirstTermin(page, 'dokumente');
    await page.locator('#tk-attachments-grid [data-dv-index]').nth(1).click();
    await expect(page.locator('#dv-pdf canvas').first()).toBeVisible({ timeout: 30000 });
    await page.keyboard.press('Escape');
    expect(await verstoesse(page)).toEqual([]);
  });

  test('Dokumentenscanner: OpenCV läuft ohne unsafe-eval', async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript(SAMMLER);
    await page.addInitScript(() => { try { localStorage.setItem('feldfolio-scan-auto', 'false'); } catch { /* */ } });
    await page.goto('/');
    await page.evaluate(() => { window.__ffTestTk.loginFake(); window.__ffTestTk.addEvent({ kunde: 'Hof Scan' }); });
    await gotoKontrolleKalender(page);
    await openFirstTermin(page, 'dokumente');
    await page.locator('#tk-scan-btn').click();
    await expect(page.locator('#scan-modal-overlay')).toBeVisible();
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 840;
      const g = c.getContext('2d'); g.fillStyle = '#444'; g.fillRect(0, 0, 600, 840); g.fillStyle = '#fff'; g.fillRect(70, 70, 460, 680);
      return c.toDataURL('image/png');
    });
    await page.setInputFiles('#scan-gallery-input', { name: 'beleg.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    await expect(page.locator('#scan-crop-view')).toBeVisible({ timeout: 90000 });
    await page.locator('#scan-crop-confirm').click();
    await expect(page.locator('#scan-review-busy')).toBeHidden({ timeout: 30000 });
    expect(await page.evaluate(() => !!(window.cv && window.cv.Mat))).toBe(true);
    expect(await verstoesse(page)).toEqual([]);
  });
});
