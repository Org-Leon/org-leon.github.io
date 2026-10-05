import { test, expect } from '@playwright/test';

// Top-Bar (Variante A „Kompakt mit Suche"): Menü · Logo | Tool-Switcher ·
// Suche · Speicherstatus · Betriebs-Chip · Hell/Dunkel · Konto.
// Speicherstatus mit echtem Sync-Zustand und Betriebs-Avatar: offline.spec.js.

const SCHLAEGE = [
  { nr: '1', name: 'Hinterm Hof', flik: 'DETHLI0512345678', x: 10.40 },
  { nr: '2', name: 'Große Wiese', flik: 'DETHLI0598765432', x: 10.44 },
  { nr: '12', name: 'Am Bach', flik: 'DETHLI0511112222', x: 10.48 }
];
async function loadSchlaege(page) {
  const fc = { type: 'FeatureCollection', features: SCHLAEGE.map(s => ({
    type: 'Feature',
    properties: { SCHLAG_NR: s.nr, NAME: s.name, FLIK: s.flik, NUTZ_BEZ: 'Winterweizen' },
    geometry: { type: 'Polygon', coordinates: [[[s.x, 51.1], [s.x + 0.003, 51.1], [s.x + 0.003, 51.102], [s.x, 51.102], [s.x, 51.1]]] }
  })) };
  await page.setInputFiles('#file-input', { name: 'Schlaege.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('#feature-table-body tr').length)).toBeGreaterThan(0);
}
// Liegt der Kartenmittelpunkt in der Fläche mit dieser Start-Länge?
const mapCenteredOn = (page, x) => page.evaluate((x0) => {
  const c = window.__ffTestMap.getCenter();
  return c.lng > x0 && c.lng < x0 + 0.003 && c.lat > 51.1 && c.lat < 51.102;
}, x);

test.describe('Top-Bar Desktop', () => {
  test.use({ viewport: { width: 1400, height: 850 } });

  test('Reihenfolge, 44-px-Ziele, Beschriftungen, bündig mit der Sidebar', async ({ page }) => {
    await page.goto('/');
    const ids = await page.evaluate(() => [...document.querySelectorAll('#tabbar > *')]
      .filter(el => el.offsetParent).map(el => el.id || el.className));
    expect(ids).toEqual(['tabbar-left', 'topbar-search-wrap', 'btn-betrieb', 'design-toggle', 'theme-toggle', 'btn-account']);
    const leftIds = await page.evaluate(() => [...document.querySelectorAll('#tabbar-left > *')].map(el => el.id || el.className));
    expect(leftIds).toEqual(['brand-logo', 'tabbar-divider', 'tool-switcher']);
    // Alle sichtbaren Buttons ≥ 44×44 und mit zugänglichem Namen.
    const buttons = await page.evaluate(() => [...document.querySelectorAll('#tabbar button')].filter(b => b.offsetParent)
      .map(b => ({ id: b.id, w: b.offsetWidth, h: b.offsetHeight, name: b.getAttribute('aria-label') || b.textContent.trim() })));
    for (const b of buttons) {
      expect(b.w, b.id).toBeGreaterThanOrEqual(44);
      expect(b.h, b.id).toBeGreaterThanOrEqual(44);
      expect(b.name, b.id).toBeTruthy();
    }
    await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-label', /modus/);
    // Suche ist ein echtes <input> mit <label>.
    await expect(page.locator('label[for="topbar-search"]')).toHaveText('Flächen suchen');
    await expect(page.getByRole('combobox', { name: 'Flächen suchen' })).toHaveAttribute('placeholder', 'Schlag, Flächenname oder FLIK suchen');
    await expect(page.locator('#topbar-search')).toHaveAttribute('type', 'search');
    // Unterkante der Leiste = Oberkante der Sidebar (kein Versatz).
    const [barBottom, sidebarTop] = await page.evaluate(() => [
      document.getElementById('tabbar').getBoundingClientRect().bottom,
      document.getElementById('sidebar').getBoundingClientRect().top]);
    expect(Math.abs(barBottom - sidebarTop)).toBeLessThan(1);
    // Ohne Anmeldung kein Speicherstatus.
    await expect(page.locator('#save-status')).toBeHidden();
  });

  test('Suche beginnt fest am linken Kartenrand — unabhängig von Speicherstatus und Funktionsname', async ({ page }) => {
    await page.goto('/');
    const left = () => page.evaluate(() => ({
      search: document.getElementById('topbar-search').getBoundingClientRect().left,
      zoom: document.querySelector('.leaflet-control-zoom').getBoundingClientRect().left,
      map: document.getElementById('map-wrap').getBoundingClientRect().left
    }));
    const base = await left();
    // bündig mit den Zoom-Buttons (12px Einzug vom Kartenrand)
    expect(base.search).toBe(base.zoom);
    expect(base.search - base.map).toBe(12);
    // Speicherstatus erscheint (Anmeldung) — Suche bleibt stehen.
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await expect(page.locator('#save-status')).toBeVisible();
    expect((await left()).search).toBe(base.search);
    // ... und verschwindet wieder.
    await page.evaluate(() => window.__ffTestTk.logoutFake());
    await expect(page.locator('#save-status')).toBeHidden();
    expect((await left()).search).toBe(base.search);
    // Lange Funktionsnamen (mit "+" am Logo) passen vollständig und schieben nichts.
    await page.evaluate(() => window.__ffTestTk.loginFake());
    for (const view of ['obstbaum', 'uebersicht', 'bienenflug', 'kontrolle', 'stallplaner']) {
      await page.locator(`.segment-btn[data-view="${view}"]`).click();
      const fits = await page.locator('#current-view-title').evaluate(el => el.scrollWidth <= el.clientWidth);
      expect(fits, view).toBe(true);
      expect(await page.locator('#topbar-search').evaluate(el => el.getBoundingClientRect().left), view).toBe(base.search);
    }
  });

  test('Zoom-Buttons im Stil der Kartenbedienelemente', async ({ page }) => {
    await page.goto('/');
    const zoom = page.locator('.leaflet-control-zoom');
    await expect(zoom).toHaveCSS('border-radius', '10px');
    const [bg, panel] = await page.evaluate(() => [
      getComputedStyle(document.querySelector('.leaflet-control-zoom')).backgroundColor,
      getComputedStyle(document.getElementById('sidebar')).backgroundColor]);
    expect(bg).toBe(panel); // --panel wie die übrigen Flächen
    await expect(page.locator('.leaflet-control-zoom-in')).toHaveCSS('width', '32px');
    // Zoomen funktioniert weiterhin.
    const z0 = await page.evaluate(() => window.__ffTestMap.getZoom());
    await page.locator('.leaflet-control-zoom-in').click();
    await expect.poll(() => page.evaluate(() => window.__ffTestMap.getZoom())).toBe(z0 + 1);
  });

  test('Aktuelle Funktion: reine Anzeige auf dem Desktop, folgt der Sidebar-Auswahl', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#current-view-title')).toHaveText('Karte');
    await expect(page.locator('#current-view-icon')).toHaveText('map');
    await expect(page.locator('#tool-menu')).toHaveCount(0);
    await expect(page.locator('#btn-current-view')).toHaveAttribute('tabindex', '-1');
    await page.locator('.segment-btn[data-view="hofplan"]').click();
    await expect(page.locator('#current-view-title')).toHaveText('Hofplan');
    await expect(page.locator('#current-view-icon')).toHaveText('home_work');
    // Klick darauf ändert nichts (kein Menü, keine Schublade).
    await page.locator('#btn-current-view').click({ force: true }); // aria-disabled
    await expect(page.locator('body')).not.toHaveClass(/sidebar-open/);
    await expect(page.locator('.segment-btn[data-view="hofplan"]')).toHaveClass(/active/);
  });

  test('Sidebar behält ihre Breite in jeder Funktion (Scrollleiste verschiebt nichts)', async ({ page }) => {
    await page.goto('/');
    const measure = () => page.evaluate(() => ({
      content: document.getElementById('sidebar').clientWidth,
      compareBtn: document.querySelector('.segment-btn[data-view="compare"]').getBoundingClientRect().width
    }));
    const base = await measure();
    for (const view of ['compare', 'zeichner', 'obstbaum', 'bienenflug', 'hofplan', 'stallplaner', 'tiere', 'uebersicht', 'viewer']) {
      await page.locator(`.segment-btn[data-view="${view}"]`).click();
      expect(await measure(), view).toEqual(base);
    }
  });

  test('Suche findet Schläge nach Nummer, Name und FLIK und springt zur Fläche', async ({ page }) => {
    await page.goto('/');
    await loadSchlaege(page);
    const search = page.locator('#topbar-search');
    const hits = page.locator('.topbar-search-item');

    await search.fill('wiese');
    await expect(hits).toHaveCount(1);
    await expect(hits.first()).toContainText('Große Wiese');
    await search.fill('DETHLI0511112222');
    await expect(hits.first()).toContainText('Am Bach');
    // Exakte Schlagnummer vor Teiltreffern ("1" vor "12").
    await search.fill('1');
    await expect(hits.first()).toContainText('Schlag 1 ·');
    await search.fill('xyz');
    await expect(page.locator('.topbar-search-empty')).toHaveText('Keine Fläche gefunden.');

    // Pfeil + Enter springt wie ein Tabellen-Klick zur Fläche.
    await search.fill('DETHLI05');
    await page.keyboard.press('ArrowDown');
    await expect(hits.nth(1)).toHaveClass(/active/);
    const secondTitle = await hits.nth(1).locator('span').textContent();
    await page.keyboard.press('Enter');
    await expect(page.locator('#topbar-search-results')).toBeHidden();
    await expect(search).toHaveValue('');
    const target = SCHLAEGE.find(s => secondTitle.includes(s.name));
    await expect.poll(() => mapCenteredOn(page, target.x)).toBe(true);
    await expect(page.locator('#feature-table-body tr.row-selected')).toHaveCount(1);
  });

  test('Suche aus einer Ansicht ohne Karte wechselt zur Karte; Strg+K fokussiert', async ({ page }) => {
    await page.goto('/');
    await loadSchlaege(page);
    await page.locator('.segment-btn[data-view="uebersicht"]').click();
    await expect(page.locator('#map-wrap')).toBeHidden();
    await page.keyboard.press('Control+k');
    await expect(page.locator('#topbar-search')).toBeFocused();
    await page.keyboard.type('Am Bach');
    await page.locator('.topbar-search-item').first().click();
    await expect(page.locator('.segment-btn[data-view="viewer"]')).toHaveClass(/active/);
    await expect(page.locator('#map-wrap')).toBeVisible();
    await expect.poll(() => mapCenteredOn(page, 10.48)).toBe(true);
    // Esc leert das Feld.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Hof');
    await page.keyboard.press('Escape');
    await expect(page.locator('#topbar-search')).toHaveValue('');
  });

  test('Betriebs-Chip, Hell/Dunkel und Konto', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-betrieb')).toContainText('Betrieb wählen');
    await expect(page.locator('#btn-betrieb .betrieb-avatar')).toHaveCount(0);

    const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const before = await theme();
    await page.locator('#theme-toggle').click();
    expect(await theme()).not.toBe(before);
    // Sichtbar ist immer genau ein Symbol (Ziel-Modus).
    await expect(page.locator('#theme-toggle .theme-icon:visible')).toHaveCount(1);
    await page.locator('#theme-toggle').click();
    expect(await theme()).toBe(before);

    // Nicht angemeldet: Konto öffnet den Login-Dialog.
    await expect(page.locator('#btn-account')).toHaveAttribute('aria-label', 'Konto: anmelden');
    await page.locator('#btn-account').click();
    await expect(page.locator('#account-modal-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__ffTestTk.loginFake('a@b.de'));
    await expect(page.locator('#btn-account')).toHaveClass(/logged-in/);
    await expect(page.locator('#btn-account')).toHaveAttribute('aria-label', /a@b\.de/);
  });
});

test.describe('Top-Bar schmal (< 900 px)', () => {
  test.use({ viewport: { width: 800, height: 700 } });

  test('Suche als Lupe, Feld öffnet über der Leiste; Speicherstatus nur Punkt', async ({ page }) => {
    await page.goto('/');
    await loadSchlaege(page);
    await expect(page.locator('#topbar-search')).toBeHidden();
    await page.locator('#btn-topbar-search').click();
    await expect(page.locator('#topbar-search')).toBeVisible();
    await expect(page.locator('#topbar-search')).toBeFocused();
    await expect(page.locator('#btn-topbar-search-back')).toBeVisible();
    await page.keyboard.type('Hinterm');
    await page.keyboard.press('Enter');
    await expect(page.locator('#topbar-search')).toBeHidden();
    await expect.poll(() => mapCenteredOn(page, 10.40)).toBe(true);
    // Zurück-Pfeil schließt das Feld wieder.
    await page.locator('#btn-topbar-search').click();
    await page.locator('#btn-topbar-search-back').click();
    await expect(page.locator('#topbar-search')).toBeHidden();

    await page.evaluate(() => window.__ffTestTk.loginFake());
    await expect(page.locator('#save-status .save-dot')).toBeVisible();
    const textWidth = await page.locator('#save-status-text').evaluate(el => el.getBoundingClientRect().width);
    expect(textWidth).toBeLessThanOrEqual(1);
    await expect(page.locator('#save-status')).toHaveAttribute('aria-label', /Gespeichert|Nicht synchron/);
  });
});

test.describe('Top-Bar Handy (< 600 px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Logo nur Symbol, Betriebs-Chip nur Avatar, nichts läuft über', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#brand-logo .ff-apple')).toBeVisible();
    await expect(page.locator('#brand-logo .ff-txt').first()).toBeHidden();
    await expect(page.locator('#btn-betrieb .btn-betrieb-name')).toBeHidden();
    await expect(page.locator('#btn-betrieb .betrieb-empty-icon')).toBeVisible();
    const [scrollW, clientW] = await page.locator('#tabbar').evaluate(el => [el.scrollWidth, el.clientWidth]);
    expect(scrollW).toBeLessThanOrEqual(clientW);
    // Tool-Switcher öffnet am Handy die Schublade, nicht das Menü.
    await page.locator('#btn-current-view').click();
    await expect(page.locator('body')).toHaveClass(/sidebar-open/);
    await expect(page.locator('#tool-menu')).toBeHidden();
  });
});
