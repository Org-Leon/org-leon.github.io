import { test, expect } from '@playwright/test';

// Design "Feldbuch" (Test): zweite Gestaltung, umschaltbar über den Knopf in
// der Kopfzeile bzw. ?design=feldbuch — das Standard-Design bleibt Vorgabe.
const stil = (page, sel) => page.locator(sel).first().evaluate(el => {
  const cs = getComputedStyle(el);
  return { radius: cs.borderTopLeftRadius, font: cs.fontFamily, bg: cs.backgroundColor };
});

test.describe('Design (Test): Standard / Feldbuch', () => {
  test('Schriften ohne Google Fonts: keine Anfrage an Google, Fraunces und Plex aus der App', async ({ page }) => {
    const fremd = [];
    const eigen = [];
    page.on('request', r => {
      const u = r.url();
      if (/fonts.(googleapis|gstatic).com/.test(u)) fremd.push(u);
      else if (r.resourceType() === 'font') eigen.push(new URL(u).origin);
    });
    await page.goto('/');
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('900 21px Fraunces'); }), { timeout: 15000 }).toBe(true);
    await page.locator('#design-toggle').click();
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('500 13px "FF Plex Mono"'); }), { timeout: 15000 }).toBe(true);
    expect(fremd).toEqual([]);
    expect(eigen.length).toBeGreaterThan(0);
    expect([...new Set(eigen)]).toEqual([new URL(page.url()).origin]);
    await page.locator('#design-toggle').click(); // zurück auf Standard
  });


  test('Standard ist Vorgabe; Umschalter wechselt, Wahl bleibt nach dem Neuladen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-design', /.+/);
    const vorher = await stil(page, '.segment-btn');
    expect(vorher.radius).not.toBe('0px');

    await page.locator('#design-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-design', 'feldbuch');
    await expect(page.locator('#design-toggle')).toHaveAttribute('aria-pressed', 'true');
    const feld = await stil(page, '.segment-btn');
    expect(feld.radius).toBe('0px');                 // harte Kanten
    expect(feld.font).toContain('FF Plex Sans');      // Text-Schrift (IBM Plex, selbst ausgeliefert) …
    expect((await stil(page, '.segment-btn[data-view="viewer"] .segment-label')).font).toContain('FF Plex Mono'); // … Beschriftung als Etikett
    expect(feld.bg).not.toBe(vorher.bg);
    expect((await stil(page, '#current-view-title')).font).toContain('Fraunces');
    // Schriften kommen von der App selbst und sind tatsächlich geladen
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('500 13px "FF Plex Mono"') && document.fonts.check('600 14px "FF Plex Sans"'); }), { timeout: 15000 }).toBe(true);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-design', 'feldbuch');
    await page.locator('#design-toggle').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-design', /.+/);
    expect((await stil(page, '.segment-btn')).radius).toBe(vorher.radius);
    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-design', /.+/);
  });

  test('?design=feldbuch schaltet direkt um; Hell und Dunkel haben eigene Farben', async ({ page }) => {
    await page.goto('/?design=feldbuch');
    await expect(page.locator('html')).toHaveAttribute('data-design', 'feldbuch');
    const dunkel = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.locator('#theme-toggle').click();
    // Farbwechsel läuft mit kurzem Übergang
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(230, 219, 193)'); // Aktenpapier
    expect(dunkel).toBe('rgb(27, 25, 20)'); // Archiv bei Lampenlicht
    await page.goto('/?design=standard');
    await expect(page.locator('html')).not.toHaveAttribute('data-design', /.+/);
  });

  test('Feldbuch: drei Schriftrollen, Symbole zum Thema und die Karte als alte Feldkarte', async ({ page }) => {
    await page.goto('/?design=feldbuch');
    await page.evaluate(() => window.__ffTestTk.loginFake());
    const schrift = (sel) => page.locator(sel).first().evaluate(el => { const cs = getComputedStyle(el); return { familie: cs.fontFamily, stil: cs.fontStyle, versalien: cs.textTransform }; });
    // Titel: Fraunces; Erläuterung: Fraunces kursiv; Text: Plex Sans; Etikett: Plex Mono in Versalien
    expect((await schrift('#current-view-title')).familie).toContain('Fraunces');
    expect(await schrift('#brand-caption')).toMatchObject({ stil: 'italic' });
    expect((await schrift('#brand-caption')).familie).toContain('Fraunces');
    expect((await schrift('body')).familie).toContain('FF Plex Sans');
    expect(await schrift('.segment-btn[data-view="viewer"] .segment-label')).toMatchObject({ versalien: 'uppercase' });
    expect((await schrift('#save-status')).familie).toContain('FF Plex Mono');
    // Karte: getönte Kacheln, leicht abgedunkelter Rand mit Papierfaser — ohne Rahmen und Windrose …
    expect(await page.locator('#map .leaflet-tile-pane').evaluate(el => getComputedStyle(el).filter)).toContain('sepia');
    expect(await page.locator('#map').evaluate(el => getComputedStyle(el, '::after').backgroundImage)).toContain('radial-gradient');
    expect(await page.locator('#map').evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
    // … und nicht im Karten-Export (PDF)
    expect(await page.locator('#map').evaluate(el => { el.classList.add('ff-capture'); const d = getComputedStyle(el, '::after').display; el.classList.remove('ff-capture'); return d; })).toBe('none');
    // Symbole: eigene Icon-Schrift (gestochen) und Themen-Symbole in der Navigation
    expect((await schrift('.segment-btn[data-view="viewer"] > .icon')).familie).toContain('FF Symbole Feldbuch');
    const ikon = (sel) => page.locator(sel).evaluate(el => getComputedStyle(el, '::before').content);
    expect(await ikon('.segment-btn[data-view="viewer"] > .icon')).toBe('"explore"');
    expect(await ikon('.segment-btn[data-view="zeichner"] > .icon')).toBe('"ink_pen"');
    expect(await ikon('#kontrolle-switcher > .icon:not(.segment-chevron)')).toBe('"inventory_2"');
    expect(await ikon('#current-view-icon')).toBe('"explore"');   // Kopfzeile folgt der Ansicht
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('24px "FF Symbole Feldbuch"'); }), { timeout: 15000 }).toBe(true);
    // Standard-Design bleibt unberührt
    await page.goto('/?design=standard');
    expect(await page.locator('#map .leaflet-tile-pane').evaluate(el => getComputedStyle(el).filter)).toBe('none');
    expect(await page.locator('#map').evaluate(el => getComputedStyle(el, '::after').content)).toBe('none');
    expect(await page.locator('.segment-btn[data-view="viewer"] > .icon').evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
  });

  test('Feldbuch am Handy: Umschalter in der Schublade, kein seitliches Überlaufen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#design-toggle')).toBeHidden();
    await page.locator('#btn-sidebar-toggle').click();
    await page.locator('#btn-design-mobile').click();
    await expect(page.locator('html')).toHaveAttribute('data-design', 'feldbuch');
    for (const view of ['uebersicht', 'tiere', 'compare', 'viewer']) {
      await page.evaluate((v) => document.querySelector(`.segment-btn[data-view="${v}"]`).click(), view);
      const o = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      expect(o[0], view).toBeLessThanOrEqual(o[1] + 1);
    }
  });
});
