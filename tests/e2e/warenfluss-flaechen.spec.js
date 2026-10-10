import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud, gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Warenflussprüfung Pflanzenbau: summierte Hektar je Kultur kommen aus der
// Flächenübersicht des Betriebs (nur wenn dieser Betrieb gewählt ist).
const FLAECHEN = [['Winterweichweizen', '2.5000'], ['Winterweichweizen', '1.2345'], ['Sommerhafer', '3.00'], ['Winterhafer', '0.50'], ['Wiesen', '5.00'], ['Ackerbohnen', '1.10']];
function shape() {
  const fc = { type: 'FeatureCollection', features: FLAECHEN.map(([kultur, ha], i) => {
    const x = 10.40 + i * 0.004, y = 51.105;
    return { type: 'Feature', properties: { SCHLAG_NR: String(i + 1), NUTZ_BEZ: kultur, FLAECHE: ha },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] } };
  }) };
  return { name: 'Schlaege.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) };
}
async function setup(page, { betrieb = true, flaechen = true } = {}) {
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await loginWithCloud(page);
  const id = await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Biohof Sonnental' }));
  if (betrieb) await page.evaluate(() => window.__ffTestOffline.switchTo('Biohof Sonnental'));
  if (flaechen) await page.setInputFiles('#file-input', shape());
  await gotoKontrolleKalender(page);
  await openFirstTermin(page, 'protokolle');
  return id;
}
async function newPruefung(page, modul) {
  await page.locator('#tk-warenfluss-new').click();
  await page.locator(`[data-wf-new="${modul}"]`).click();
  await expect(page.locator('#warenfluss-overlay')).toBeVisible();
}
const sec = (page, key) => page.locator(`.wf-section[data-table="${key}"]`);

test.describe('Warenflussprüfung: Flächen aus der Flächenübersicht', () => {
  test('Kultur wählen trägt die summierte Fläche ein; Handeingabe hat Vorrang', async ({ page }) => {
    const id = await setup(page);
    await newPruefung(page, 'pflanzenbau');
    const e = sec(page, 'ertrag');
    await expect(e.locator('[data-wf-flaechen]')).toBeVisible();

    await e.locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await expect(e.locator('[data-field="flaeche"]').first()).toHaveValue('3,7345'); // 2,5 + 1,2345
    const badge = e.locator('tbody tr').first().locator('.wf-fl-src');
    await expect(badge).toHaveText('Flächenübersicht');
    await expect(badge).toHaveAttribute('title', /Winterweichweizen · 2 Flächen/);
    await expect(e.locator('[data-calc="erwartet"]').first()).toContainText('153,9'); // 3,7345 × 41,2
    await e.locator('[data-field="ernte"]').first().fill('150');
    await expect(page.locator('#wf-auto-text')).toContainText('Winterweizen: 3,7345 ha (lt. Flächenübersicht), Ernte 150 dt');

    // andere Kultur: Fläche folgt (Sommer- und Winterhafer zusammen)
    await e.locator('select[data-field="kultur"]').first().selectOption('hafer');
    await expect(e.locator('[data-field="flaeche"]').first()).toHaveValue('3,5');
    // Kultur ohne Flächen im Betrieb: automatisch gefüllter Wert wird geleert
    await e.locator('select[data-field="kultur"]').first().selectOption('dinkel');
    await expect(e.locator('[data-field="flaeche"]').first()).toHaveValue('');
    await expect(e.locator('tbody tr').first().locator('.wf-fl-src')).toHaveCount(0);

    // Handeingabe bleibt beim Kulturwechsel stehen, Kennzeichnung verschwindet
    await e.locator('select[data-field="kultur"]').first().selectOption('hafer');
    await e.locator('[data-field="flaeche"]').first().fill('2');
    await expect(e.locator('tbody tr').first().locator('.wf-fl-src')).toHaveCount(0);
    await e.locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await expect(e.locator('[data-field="flaeche"]').first()).toHaveValue('2');

    // Saatgut-Tabelle füllt genauso
    const s = sec(page, 'saat');
    await s.locator('select[data-field="kultur"]').first().selectOption('ackerbohne');
    await expect(s.locator('[data-field="flaeche"]').first()).toHaveValue('1,1');

    const stored = await page.evaluate((evId) => structuredClone(window.__ffTestTk.getEvent(evId).warenfluss[0].tables), id);
    expect(stored.saat[0]).toMatchObject({ kultur: 'ackerbohne', flaeche: 1.1, flaecheAuto: true });
    expect(stored.ertrag[0]).toMatchObject({ flaeche: 2, flaecheAuto: false });
  });

  test('„Kulturen aus Flächenübersicht übernehmen" legt je passender Kultur eine Zeile an', async ({ page }) => {
    await setup(page);
    await newPruefung(page, 'pflanzenbau');
    const e = sec(page, 'ertrag');
    await e.locator('[data-wf-flaechen]').click();
    const rows = e.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    const werte = await rows.evaluateAll(trs => trs.map(tr => [tr.querySelector('select[data-field="kultur"]').value, tr.querySelector('[data-field="flaeche"]').value]));
    expect(werte).toEqual([['winterweizen', '3,7345'], ['hafer', '3,5'], ['ackerbohne', '1,1']]);
    await expect(e.locator('tfoot')).toContainText('8,3 ha');
    await expect(page.locator('#wf-fl-status-ertrag')).toContainText('3 Kulturen übernommen');
    await expect(page.locator('#wf-fl-status-ertrag')).toContainText('Ohne Referenzwert, nicht übernommen: Wiesen');
    // zweiter Klick ändert nichts
    await e.locator('[data-wf-flaechen]').click();
    await expect(e.locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('#wf-fl-status-ertrag')).toContainText('Alle passenden Kulturen sind schon eingetragen');
  });

  test('Warenflusskette: Stufe „Erzeugung · Pflanzenbau" übernimmt die Fläche', async ({ page }) => {
    await setup(page);
    await newPruefung(page, 'kette');
    const st = page.locator('.wf-stage').first();
    await st.locator('[data-sf="art"]').selectOption('pflanze');
    await st.locator('[data-field="refKey"]').selectOption('winterweizen');
    await expect(st.locator('.wf-sfield[data-sfield="basis"] input')).toHaveValue('3,7345');
    await expect(st.locator('.wf-sfield[data-sfield="basis"] .wf-fl-src')).toBeVisible();
  });

  test('ohne gewählten Betrieb bzw. ohne Flächen: Hinweis statt Übernahme', async ({ page }) => {
    await setup(page, { betrieb: false });
    await newPruefung(page, 'pflanzenbau');
    const e = sec(page, 'ertrag');
    await expect(e.locator('[data-wf-flaechen]')).toHaveCount(0);
    await expect(e.locator('.wf-fl-hint')).toContainText('sobald „Biohof Sonnental“ als Betrieb gewählt ist');
    await e.locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await expect(e.locator('[data-field="flaeche"]').first()).toHaveValue('');
  });
});
