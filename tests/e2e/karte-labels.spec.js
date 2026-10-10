import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud } from './helpers.js';

// Flächennamen auf der Karte: erst ab Zoomstufe 15 sichtbar (vorher nur der
// Betriebspin), Gestaltung als FeldFolio-Pille (Nummer + Name).
async function loadFlaechen(page) {
  const fc = { type: 'FeatureCollection', features: [['1', 'Hinterm Hof'], ['2', 'Lange Breite']].map(([nr, name], i) => {
    const x = 10.40 + i * 0.004, y = 51.105;
    return { type: 'Feature', properties: { SCHLAG_NR: nr, NAME: name, NUTZ_BEZ: 'Winterweizen', FLAECHE: '2.00' },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] } };
  }) };
  await page.setInputFiles('#file-input', { name: 'Schlaege.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });
}
// Zoom setzen, nachdem eine laufende Zoom-Animation (fitBounds nach dem
// Laden) beendet ist — sonst überschreibt deren zoomend den Testzoom.
async function setZoom(page, z) {
  await page.waitForTimeout(400);
  await page.evaluate((zoom) => new Promise(res => {
    const m = window.__ffTestMap;
    m.stop();
    if (m.getZoom() === zoom) return res();
    m.once('zoomend', () => res());
    m.setView([51.106, 10.403], zoom, { animate: false });
  }), z);
  await expect.poll(() => page.evaluate(() => window.__ffTestMap.getZoom())).toBe(z);
}
const labels = (page) => page.locator('#map .leaflet-tooltip.feature-label');

test.describe('Flächennamen auf der Karte', () => {
  test('erst beim Hineinzoomen sichtbar — vorher nur der Betriebspin', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Biohof Sonnental', lat: 51.106, lng: 10.403, address: 'Talweg 4, Weimar', geocodeStatus: 'ok' }));
    await page.evaluate(() => window.__ffTestOffline.switchTo('Biohof Sonnental'));
    await loadFlaechen(page);
    await expect(labels(page)).toHaveCount(2);

    await setZoom(page, 12);
    await expect(page.locator('#map')).toHaveClass(/ff-labels-far/);
    await expect(labels(page).first()).toBeHidden();
    await expect(page.locator('.leaflet-marker-pane .betrieb-pin')).toBeVisible();

    await setZoom(page, 16);
    await expect(page.locator('#map')).not.toHaveClass(/ff-labels-far/);
    await expect(labels(page).first()).toBeVisible();
    await expect(page.locator('.leaflet-marker-pane .betrieb-pin')).toBeVisible();
  });

  test('Gestaltung: Nummer hervorgehoben, Name darunter, im App-Design', async ({ page }) => {
    await page.goto('/');
    await loadFlaechen(page);
    await setZoom(page, 16);
    const first = labels(page).filter({ hasText: 'Hinterm Hof' });
    await expect(first.locator('b')).toHaveText('1');
    await expect(first.locator('span')).toHaveText('Hinterm Hof');
    const style = await first.evaluate(el => { const cs = getComputedStyle(el); return { radius: cs.borderTopLeftRadius, font: cs.fontFamily, bColor: getComputedStyle(el.querySelector('b')).color }; });
    expect(style.radius).toBe('9px');
    const accent = await page.evaluate(() => { const t = document.createElement('i'); t.style.color = 'var(--accent)'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; });
    expect(style.bColor).toBe(accent);
  });

  test('zoomen ohne Nachziehen: Labels nutzen Leaflets Zoom-Animation und sitzen mittig auf der Fläche', async ({ page }) => {
    await page.goto('/');
    await loadFlaechen(page);
    await setZoom(page, 16);
    const label = labels(page).filter({ hasText: 'Hinterm Hof' });
    // Während der Zoom-Animation muss das Label wie die Flächen per transform
    // mitlaufen (eigene transition-Regeln dürfen das nicht überschreiben).
    const transition = await label.evaluate(el => {
      const c = document.getElementById('map');
      c.classList.add('leaflet-zoom-anim');
      const t = getComputedStyle(el).transitionProperty;
      c.classList.remove('leaflet-zoom-anim');
      return t;
    });
    expect(transition).toContain('transform');
    // Nach mehrfachem Rein-/Rauszoomen liegt das Label weiter mittig auf der Fläche.
    for (const z of [17, 15, 18, 16]) await setZoom(page, z);
    const off = await label.evaluate(el => {
      const r = el.getBoundingClientRect();
      const m = window.__ffTestMap;
      const p = m.latLngToContainerPoint([51.106, 10.4015]); // Mitte von Schlag 1
      const mr = m.getContainer().getBoundingClientRect();
      return { dx: Math.abs(r.left + r.width / 2 - (mr.left + p.x)), dy: Math.abs(r.top + r.height / 2 - (mr.top + p.y)) };
    });
    expect(off.dx).toBeLessThan(3);
    expect(off.dy).toBeLessThan(3);
  });
});
