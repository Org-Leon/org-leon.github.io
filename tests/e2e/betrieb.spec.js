import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud } from './helpers.js';

// Dialog "Betrieb wählen" (Betriebs-Chip in der Kopfzeile): aktuelle
// Zuordnung, Suche, Betriebe mit Termin-Infos, anstehende Termine, manuell
// angelegte Betriebe, Leerzustand ohne Anmeldung.

function daysFromNow(n) {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
async function addTermine(page) {
  await page.evaluate((dates) => {
    const T = window.__ffTestTk;
    T.addEvent({ kunde: 'Obsthof Huber GbR', auditart: 'Öko-Kontrolle', date: new Date(dates[0]) });
    T.addEvent({ kunde: 'Obsthof Huber GbR', auditart: 'Nachkontrolle', date: new Date(dates[1]) });
    T.addEvent({ kunde: 'Biohof Sonnental', auditart: 'Öko-Kontrolle', date: new Date(dates[2]) });
    T.addEvent({ kunde: 'Weingut Berger', auditart: 'Stichprobe', date: new Date(dates[3]) });
  }, [daysFromNow(3), daysFromNow(-40), daysFromNow(10), daysFromNow(-5)]);
}
const openDialog = (page) => page.locator('#btn-betrieb').click();
const rows = (page) => page.locator('#betrieb-list .betrieb-row-select');

test.describe('Betrieb wählen', () => {
  test('Ohne Anmeldung: Leerzustand mit Weg zur Anmeldung', async ({ page }) => {
    await page.goto('/');
    await openDialog(page);
    await expect(page.locator('#betrieb-not-configured')).toBeVisible();
    await expect(page.locator('#betrieb-editor')).toBeHidden();
    await page.locator('#betrieb-btn-login').click();
    await expect(page.locator('#betrieb-modal-overlay')).toBeHidden();
    await expect(page.locator('#account-modal-overlay')).toBeVisible();
  });

  test('Liste zeigt Betriebe mit Termin-Infos und anstehende Termine; Suche filtert', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await addTermine(page);
    await openDialog(page);

    await expect(page.locator('#betrieb-current-name')).toHaveText('Kein Betrieb');
    await expect(page.locator('#betrieb-current-card')).toHaveClass(/is-empty/);
    await expect(page.locator('#betrieb-search')).toBeFocused();
    // Erklärung ist eingeklappt.
    await expect(page.locator('.betrieb-info p')).toBeHidden();

    const betriebe = page.locator('#betrieb-list .betrieb-row-select[data-action="select-betrieb"]');
    await expect(betriebe).toHaveCount(3);
    const huber = betriebe.filter({ hasText: 'Obsthof Huber GbR' });
    await expect(huber.locator('.betrieb-row-avatar')).toHaveText('O');
    await expect(huber.locator('.betrieb-row-sub')).toContainText('2 Termine · nächster');
    await expect(betriebe.filter({ hasText: 'Weingut Berger' }).locator('.betrieb-row-sub')).toContainText('zuletzt');
    // Ohne Suche nur anstehende Termine (nicht die vergangenen).
    await expect(page.locator('.betrieb-list-group-title').nth(1)).toHaveText('Anstehende Termine');
    await expect(page.locator('[data-action="select-termin"]')).toHaveCount(2);

    // Suche: Betriebe + alle passenden Termine (auch vergangene).
    await page.locator('#betrieb-search').fill('huber');
    await expect(betriebe).toHaveCount(1);
    await expect(page.locator('[data-action="select-termin"]')).toHaveCount(2);
    await page.locator('#betrieb-search').fill('gibtsnicht');
    await expect(page.locator('.betrieb-list-empty')).toHaveCount(2);
  });

  test('Betrieb wählen, markiert wiedersehen und Zuordnung lösen', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await addTermine(page);
    await openDialog(page);
    // Enter wählt den ersten Treffer.
    await page.locator('#betrieb-search').fill('sonnen');
    await page.keyboard.press('Enter');
    await expect(page.locator('#betrieb-modal-overlay')).toBeHidden();
    await expect(page.locator('#btn-betrieb .betrieb-avatar')).toHaveText('B');
    await expect(page.locator('#btn-betrieb-label')).toContainText('Biohof Sonnental');

    await openDialog(page);
    await expect(page.locator('#betrieb-current-name')).toHaveText('Biohof Sonnental');
    await expect(page.locator('#betrieb-current-card')).not.toHaveClass(/is-empty/);
    const active = page.locator('#betrieb-list .betrieb-row.active');
    await expect(active).toHaveCount(1);
    await expect(active).toContainText('Biohof Sonnental');
    await expect(active.locator('.betrieb-row-check')).toBeVisible();

    await page.locator('#betrieb-btn-clear').click();
    await expect(page.locator('#betrieb-modal-overlay')).toBeHidden();
    await expect(page.locator('#btn-betrieb')).toContainText('Betrieb wählen');
  });

  test('Termin wählen zeigt ihn in der Aktuell-Karte', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await addTermine(page);
    await openDialog(page);
    await page.locator('[data-action="select-termin"]').first().click();
    await expect(page.locator('#betrieb-modal-overlay')).toBeHidden();
    await openDialog(page);
    await expect(page.locator('#betrieb-current-name')).toHaveText('Obsthof Huber GbR');
    await expect(page.locator('#betrieb-current-sub')).toContainText('Termin:');
    await expect(page.locator('#betrieb-current-sub')).toContainText('Öko-Kontrolle');
  });

  test('Betrieb manuell hinzufügen und wieder entfernen; X schließt', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await openDialog(page);
    await expect(page.locator('.betrieb-list-empty')).toContainText('Noch keine Betriebe');
    await page.locator('#betrieb-manual-input').fill('Hof Lindenberg');
    await page.keyboard.press('Enter');
    const row = page.locator('#betrieb-list .betrieb-row', { hasText: 'Hof Lindenberg' });
    await expect(row).toBeVisible();
    await expect(row.locator('.betrieb-row-sub')).toHaveText('Manuell angelegt');
    await row.locator('.betrieb-row-remove').click();
    await expect(row).toHaveCount(0);
    await page.locator('#betrieb-modal-close-x').click();
    await expect(page.locator('#betrieb-modal-overlay')).toBeHidden();
  });
});

test.describe('Betrieb wählen am Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('öffnet als Blatt von unten über die volle Breite', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await addTermine(page);
    await openDialog(page);
    const box = await page.locator('.betrieb-card').boundingBox();
    expect(Math.round(box.width)).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(844);
    // Suchfeld ist am Handy nicht automatisch fokussiert (Tastatur).
    await expect(page.locator('#betrieb-search')).not.toBeFocused();
    // Alle Zeilen sind ausreichend groß zum Antippen.
    const heights = await rows(page).evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
    heights.forEach(h => expect(h).toBeGreaterThanOrEqual(44));
  });
});
