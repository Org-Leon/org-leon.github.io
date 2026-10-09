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
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('900 21px Fraunces'); })).toBe(true);
    await page.locator('#design-toggle').click();
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('500 13px "FF Plex Mono"'); })).toBe(true);
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
    expect(feld.font).toContain('FF Plex Mono');      // Schreibmaschine für Beschriftungen (IBM Plex Mono, selbst ausgeliefert)
    expect(feld.bg).not.toBe(vorher.bg);
    expect((await stil(page, '#current-view-title')).font).toContain('Fraunces');
    // Schriften kommen von der App selbst und sind tatsächlich geladen
    await expect.poll(() => page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('500 13px "FF Plex Mono"') && document.fonts.check('600 14px "FF Plex Sans"'); })).toBe(true);

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
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(239, 233, 219)'); // Papier
    expect(dunkel).toBe('rgb(19, 23, 20)'); // Tinte
    await page.goto('/?design=standard');
    await expect(page.locator('html')).not.toHaveAttribute('data-design', /.+/);
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
