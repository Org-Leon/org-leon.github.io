import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud } from './helpers.js';

// Kontrolle › Betrieb: zentrale Seite des zugeordneten Betriebs mit
// Stammdaten, aktuellem Termin, Kacheln je Unterfunktion (Probenahme,
// Cross Check, Warenfluss, Dokumente, Notizen), Terminverlauf.

async function setup(page) {
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await loginWithCloud(page);
  return page.evaluate(() => {
    const at = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
    const base = { kunde: 'Biohof Sonnental', telefon: '03643 1234', address: 'Talweg 4, 99423 Weimar', plz: '99423', ort: 'Weimar', kundennummer: 'K-4711', bestaetigt: true, hasTime: true };
    const t = window.__ffTestTk;
    return {
      // nächster Termin: Grundkontrolle + Bioland + Probenahme (ein Termin)
      haupt: t.addEvent({ ...base, date: at(2, 9), auditart: 'Jahreskontrolle' }),
      bioland: t.addEvent({ ...base, date: at(2, 9), auditart: 'Bioland Verbandskontrolle' }),
      probe: t.addEvent({ ...base, date: at(2, 9), auditart: 'Probenahme' }),
      // früherer Termin mit Notiz
      alt: t.addEvent({ ...base, date: at(-200, 10), auditart: 'Jahreskontrolle', notiz: 'Lager im Altbau geprüft' }),
      fremd: t.addEvent({ kunde: 'Obsthof Huber GbR', date: at(1, 8), auditart: 'Jahreskontrolle' })
    };
  });
}
const openKontrolle = (page) => page.locator('#kontrolle-switcher').click();
const tile = (page, key) => page.locator(`.kb-tile[data-kb-tile="${key}"]`);

test.describe('Kontrolle › Betrieb', () => {
  test('Ohne Betrieb: Auswahl mit nächsten Terminen; Klick ordnet zu und zeigt die Betriebsseite', async ({ page }) => {
    await setup(page);
    await openKontrolle(page);
    await expect(page.locator('#kontrolle-uebersicht')).toBeVisible(); // ohne Betrieb Start in der Übersicht
    await page.locator('#kontrolle-tabs [data-ko-tab="betrieb"]').click();
    await expect(page.locator('#kontrolle-betrieb .kb-empty')).toContainText('Kein Betrieb zugeordnet');
    await expect(page.locator('.kb-pick')).toHaveCount(2);
    await page.locator('.kb-pick', { hasText: 'Biohof Sonnental' }).click();
    await expect(page.locator('#kb-name')).toHaveText('Biohof Sonnental');
    await expect(page.locator('#btn-betrieb')).toContainText('Biohof Sonnental');
  });

  test('Betriebsseite: Kopf, aktueller Termin mit Aufträgen, Kacheln, Verlauf — Start dort bei zugeordnetem Betrieb', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.__ffTestOffline.switchTo('Biohof Sonnental'));
    await openKontrolle(page);
    await expect(page.locator('#kontrolle-betrieb')).toBeVisible();
    await expect(page.locator('#kontrolle-tabs [data-ko-tab="betrieb"]')).toHaveAttribute('aria-selected', 'true');

    const hero = page.locator('.kb-hero');
    await expect(hero.locator('.kb-avatar')).toHaveText('B');
    await expect(hero).toContainText('Kd.-Nr. K-4711 · 99423 Weimar · 2 Termine');
    await expect(hero.locator('.tk-chip-verband[data-verband="bioland"]')).toBeVisible();
    await expect(hero.locator('.kb-hero-actions a[href^="tel:"]')).toBeVisible();
    await expect(hero.locator('a', { hasText: 'Route' })).toHaveAttribute('href', /google\.com\/maps/);

    const termin = page.locator('.kb-termin');
    await expect(termin).toContainText('Nächster Termin');
    await expect(termin.locator('.km-auftrag')).toHaveCount(3);

    // Probenahme ist beauftragt, aber noch kein Protokoll -> offen
    await expect(tile(page, 'probenprotokoll')).toHaveClass(/is-open/);
    await expect(tile(page, 'probenprotokoll').locator('.kb-tile-state')).toHaveText('beauftragt · offen');
    await expect(tile(page, 'crosscheck')).not.toHaveClass(/is-open|is-done/);
    await expect(page.locator('.kb-tile')).toHaveCount(5);

    // Verlauf: beide Termine, neuester zuerst, aktueller markiert
    const rows = page.locator('.kb-hist-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveClass(/is-current/);
    await rows.nth(1).click();
    await expect(page.locator('#kontrollmappe')).toBeVisible();
    await expect(page.locator('#kontrollmappe [data-km-tab="ueberblick"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#kontrollmappe-close').click();

    // Kachel "Kontrollmappe öffnen" -> aktueller Termin
    await page.locator('.kb-open-mappe').click();
    await expect(page.locator('#kontrollmappe .km-auftrag')).toHaveCount(3);
    await page.locator('#kontrollmappe-close').click();
  });

  test('Neues Probenahmeprotokoll aus der Kachel landet am aktuellen Termin, Kachel zeigt es als erledigt', async ({ page }) => {
    const ids = await setup(page);
    await page.evaluate(() => window.__ffTestOffline.switchTo('Biohof Sonnental'));
    await openKontrolle(page);
    await tile(page, 'probenprotokoll').locator('[data-kb-new]').click();
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeVisible();
    await expect(page.locator('#probenprotokoll-modal-title')).toHaveText('Probenahmeprotokoll');
    await page.locator('#pp-field-Probe').fill('Winterweizen');
    await page.locator('#probenprotokoll-modal-close').click();
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeHidden();

    const t = tile(page, 'probenprotokoll');
    await expect(t).toHaveClass(/is-done/);
    await expect(t.locator('.kb-tile-count')).toHaveText('1');
    await expect(t.locator('.kb-item')).toContainText('Winterweizen');
    const stored = await page.evaluate((list) => list.map(id => (window.__ffTestTk.getEvent(id).probenprotokolle || []).length), [ids.haupt, ids.bioland, ids.probe]);
    expect(stored.reduce((a, b) => a + b, 0)).toBe(1);
    // Eintrag öffnet das Protokoll wieder
    await t.locator('.kb-item').click();
    await expect(page.locator('#pp-field-Probe')).toHaveValue('Winterweizen');
  });

  test('Warenfluss aus der Kachel, Notiz, Dokumente und Sprung in die Flächen-Werkzeuge', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.__ffTestOffline.switchTo('Biohof Sonnental'));
    await openKontrolle(page);

    const wf = tile(page, 'warenfluss');
    await wf.locator('[data-kb-action="wf-new"]').click();
    await wf.locator('[data-kb-wf-new="imkerei"]').click();
    await expect(page.locator('#warenfluss-overlay')).toBeVisible();
    await page.locator('#wf-done').click();
    await expect(wf.locator('.kb-item')).toContainText('Imkerei');
    await expect(wf.locator('.kb-tile-count')).toHaveText('1');

    // Notiz: Kachel öffnet die Mappe im Reiter Notizen
    await tile(page, 'notizen').locator('[data-kb-mappe="notizen"]').click();
    await expect(page.locator('#tk-notiz')).toBeVisible();
    await page.locator('#tk-notiz').fill('Hofladen mit Zukaufware');
    await page.locator('#tk-notiz').blur();
    await page.locator('#kontrollmappe-close').click();
    await expect(tile(page, 'notizen')).toContainText('Hofladen mit Zukaufware');

    // Dokumente: öffnet die Mappe im Reiter Dokumente
    await tile(page, 'dokumente').locator('[data-kb-mappe="dokumente"]').click();
    await expect(page.locator('#kontrollmappe [data-km-tab="dokumente"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#kontrollmappe-close').click();

    // Betriebsdaten -> Flächenübersicht
    await page.locator('[data-kb-segment="uebersicht"]').click();
    await expect(page.locator('#current-view-title')).toHaveText('Flächenübersicht');
  });

  test('Flächen in Kurzform: Kennzahlen, Kulturanteile, größte Kulturen — aktualisiert sich beim Laden', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.__ffTestOffline.switchTo('Biohof Sonnental'));
    await openKontrolle(page);
    const card = page.locator('#kb-flaechen');
    await expect(card.locator('.ko-empty')).toContainText('noch keine Flächen geladen');

    // Shapefile laden, während die Betriebsseite offen ist
    const list = [['Winterweizen', '2.50'], ['Winterweizen', '1.50'], ['Silomais', '3.00'], ['Kleegras', '1.00'], ['Hafer', '0.50'], ['Dinkel', '0.40'], ['Erbsen', '0.30'], ['', '0.80']];
    const fc = { type: 'FeatureCollection', features: list.map(([kultur, ha], i) => {
      const x = 10.40 + i * 0.004, y = 51.105;
      return { type: 'Feature', properties: { SCHLAG_NR: String(i + 1), NAME: 'Schlag ' + (i + 1), NUTZ_BEZ: kultur, FLAECHE: ha },
        geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] } };
    }) };
    await page.setInputFiles('#file-input', { name: 'Schlaege.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });

    await expect(card.locator('.kb-fl-kpi').nth(0)).toContainText('10,00ha');
    await expect(card.locator('.kb-fl-kpi').nth(1)).toContainText('8Flächen');
    await expect(card.locator('.kb-fl-kpi').nth(2)).toContainText('6Kulturarten'); // ohne "Ohne Angabe"
    await expect(card.locator('.kb-fl-bar span')).toHaveCount(7);
    const items = card.locator('.kb-fl-list li');
    await expect(items).toHaveCount(6); // 5 größte + "weitere"
    await expect(items.first()).toContainText('Winterweizen4,00 ha40 %');
    await expect(items.nth(1)).toContainText('Silomais3,00 ha30 %');
    await expect(items.last()).toContainText('2 weitere Kulturen0,70 ha7 %');

    await card.locator('[data-kb-segment="uebersicht"]').click();
    await expect(page.locator('#uebersicht-view')).toBeVisible();
  });
});
