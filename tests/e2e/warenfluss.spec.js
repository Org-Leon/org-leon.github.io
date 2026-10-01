import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Warenflussprüfung am Termin (src/warenfluss.js): Bereiche, Referenzwerte
// mit Quelle, Rechnung + Ampel, Toleranzen, Mengenbilanz, Freitext.

async function openNew(page, modul) {
  await page.goto('/');
  const id = await page.evaluate(() => { window.__ffTestTk.loginFake(); return window.__ffTestTk.addEvent({ kunde: 'Biohof Sonnental' }); });
  await gotoKontrolleKalender(page);
  await openFirstTermin(page, 'protokolle');
  await page.locator('#tk-warenfluss-new').click();
  await expect(page.locator('.wf-module-btn')).toHaveCount(5);
  await page.locator(`[data-wf-new="${modul}"]`).click();
  await expect(page.locator('#warenfluss-overlay')).toBeVisible();
  return id;
}
const sec = (page, key) => page.locator(`.wf-section[data-table="${key}"]`);
const stored = (page, id) => page.evaluate((evId) => structuredClone(window.__ffTestTk.getEvent(evId).warenfluss || []), id);

test.describe('Warenflussprüfung', () => {
  test('Pflanzenbau: Referenz mit Quelle, Ertrag je ha mit Ampel, Saatgut, Toleranz', async ({ page }) => {
    const id = await openNew(page, 'pflanzenbau');
    await expect(page.locator('#wf-title')).toHaveText('Warenflussprüfung · Pflanzenbau');
    await expect(page.locator('#wf-sub')).toContainText('Biohof Sonnental');

    const ertrag = sec(page, 'ertrag');
    await ertrag.locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await expect(ertrag.locator('[data-field="refTyp"]').first()).toHaveValue('41,2');
    await expect(ertrag.locator('.wf-src').first()).toHaveText('LfL Bayern 2026');
    await expect(ertrag.locator('.wf-src').first()).toHaveAttribute('href', /stmelf\.bayern\.de/);
    await ertrag.locator('[data-field="flaeche"]').first().fill('12,5');
    await ertrag.locator('[data-field="ernte"]').first().fill('540');
    await expect(ertrag.locator('[data-calc="ertragHa"]').first()).toContainText('43,2');
    await expect(ertrag.locator('[data-calc="erwartet"]').first()).toContainText('515');
    await expect(ertrag.locator('.wf-status').first()).toHaveClass(/is-ok/);

    // Zweite Kultur, deutlich zu hoch -> auffällig
    await ertrag.locator('[data-add-row]').click();
    await ertrag.locator('select[data-field="kultur"]').nth(1).selectOption('ackerbohne');
    await ertrag.locator('[data-field="flaeche"]').nth(1).fill('6');
    await ertrag.locator('[data-field="ernte"]').nth(1).fill('210');
    await expect(ertrag.locator('tbody .wf-status').nth(1)).toHaveClass(/is-bad/);
    await expect(ertrag.locator('tfoot')).toContainText('18,5 ha');
    await expect(page.locator('#wf-summary')).toContainText('1 auffällig');
    // Referenz überschreiben (z. B. Standort mit höherem Niveau) -> plausibel
    await ertrag.locator('[data-field="refTyp"]').nth(1).fill('33');
    await expect(ertrag.locator('tbody .wf-status').nth(1)).toHaveClass(/is-ok/);
    // Toleranz verkleinern: 43,2 vs. 41,2 dt/ha = +4,9 % liegt bei ±4 % im Prüfbereich (bis 1,5 × 4 = 6 %)
    await page.locator('#wf-tol-ertrag').fill('4');
    await expect(sec(page, 'ertrag').locator('tbody .wf-status').first()).toHaveClass(/is-warn/);
    await page.locator('#wf-tol-ertrag').fill('25');

    // Saatgut: Bedarf aus Saatstärke × TKM, Annahme gekennzeichnet in der Info
    const saat = sec(page, 'saat');
    await saat.locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await expect(saat.locator('[data-field="refTyp"]').first()).toHaveValue('169');
    await expect(saat.locator('.wf-src').first()).toHaveAttribute('title', /TKM 45 g \(Annahme\)/);
    await saat.locator('[data-field="flaeche"]').first().fill('12,5');
    await saat.locator('[data-field="eingesetzt"]').first().fill('2300');
    await expect(saat.locator('[data-calc="jeHa"]').first()).toContainText('184');
    await expect(saat.locator('.wf-status').first()).toHaveClass(/is-ok/);

    // Gespeichert am Termin
    const list = await stored(page, id);
    expect(list).toHaveLength(1);
    expect(list[0].modul).toBe('pflanzenbau');
    expect(list[0].tables.ertrag[0]).toMatchObject({ kultur: 'winterweizen', flaeche: 12.5, ernte: 540 });
  });

  test('Mengenbilanz: Soll-Endbestand, Differenz und Bilanz-Toleranz', async ({ page }) => {
    await openNew(page, 'pflanzenbau');
    const b = sec(page, 'bilanz');
    await b.locator('[data-field="produkt"]').first().fill('Winterweizen');
    for (const [f, v] of [['anfang', '35'], ['zugang', '540'], ['verkauf', '480'], ['sonst', '30'], ['ende', '62']]) {
      await b.locator(`[data-field="${f}"]`).first().fill(v);
    }
    await expect(b.locator('[data-calc="soll"]').first()).toContainText('65');
    await expect(b.locator('[data-calc="diff"]').first()).toContainText('-3');
    await expect(b.locator('.wf-status').first()).toHaveClass(/is-ok/); // -0,5 % < 2 %
    await b.locator('[data-field="ende"]').first().fill('40');
    await expect(b.locator('.wf-status').first()).toHaveClass(/is-bad/); // -25 dt = -4,3 %
  });

  test('Freitext: vorformuliert aus der Tabelle, bearbeitbar, neu erzeugbar', async ({ page }) => {
    await openNew(page, 'pflanzenbau');
    await sec(page, 'ertrag').locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await sec(page, 'ertrag').locator('[data-field="flaeche"]').first().fill('10');
    await sec(page, 'ertrag').locator('[data-field="ernte"]').first().fill('420');
    await page.locator('#wf-mode [data-mode="text"]').click();
    const ta = page.locator('#wf-text');
    await expect(ta).toBeVisible();
    await expect(ta).toHaveValue(/Warenflussprüfung Pflanzenbau — Biohof Sonnental/);
    await expect(ta).toHaveValue(/Winterweizen: 10 ha, angegebene Ernte 420 dt = 42 dt\/ha\. Referenz 41,2 dt\/ha \(LfL Bayern 2026\)\. Ergebnis: plausibel/);
    await expect(ta).toHaveValue(/Grundlagen der Prüfung: Flächennachweis/);
    await expect(ta).toHaveValue(/Erläuterung der Abweichungen durch den Betrieb: \[ \]/);
    // bearbeiten bleibt erhalten
    await ta.fill('Eigener Text');
    await page.locator('#wf-mode [data-mode="tabelle"]').click();
    await page.locator('#wf-mode [data-mode="text"]').click();
    await expect(ta).toHaveValue('Eigener Text');
    page.once('dialog', d => d.accept());
    await page.locator('#wf-text-regen').click();
    await expect(ta).toHaveValue(/Warenflussprüfung Pflanzenbau/);
  });

  test('Tierhaltung, Imkerei, Verarbeitung, Handel rechnen mit ihren Referenzen', async ({ page }) => {
    await openNew(page, 'tierhaltung');
    const l = sec(page, 'leistung');
    await l.locator('select[data-field="tierart"]').first().selectOption('legehenne');
    await expect(l.locator('[data-field="refTyp"]').first()).toHaveValue('290');
    await expect(l.locator('.wf-numcell .wf-unit').first()).toHaveText('Ø Hennen');
    await l.locator('[data-field="anzahl"]').first().fill('3000');
    await l.locator('[data-field="angegeben"]').first().fill('840000');
    await expect(l.locator('[data-calc="jeTier"]').first()).toContainText('280');
    await expect(l.locator('.wf-status').first()).toHaveClass(/is-ok/);
    const f = sec(page, 'futter');
    await f.locator('select[data-field="tierart"]').first().selectOption('milchkuh');
    await f.locator('[data-field="anzahl"]').first().fill('40');
    await expect(f.locator('[data-calc="bedarf"]').first()).toContainText('76.080');
    await page.locator('#wf-done').click();

    // Imkerei
    await page.locator('#tk-warenfluss-new').click();
    await page.locator('[data-wf-new="imkerei"]').click();
    const h = sec(page, 'honig');
    await expect(h.locator('[data-field="refTyp"]').first()).toHaveValue('34,2');
    await h.locator('[data-field="voelker"]').first().fill('20');
    await h.locator('[data-field="geerntet"]').first().fill('1400');
    await expect(h.locator('.wf-status').first()).toHaveClass(/is-bad/); // 70 kg/Volk
    await page.locator('#wf-done').click();

    // Verarbeitung: Dinkel entspelzen
    await page.locator('#tk-warenfluss-new').click();
    await page.locator('[data-wf-new="verarbeitung"]').click();
    const a = sec(page, 'ausbeute');
    await a.locator('select[data-field="prozess"]').first().selectOption('dinkel-entspelzen');
    await a.locator('[data-field="einsatz"]').first().fill('10000');
    await expect(a.locator('[data-calc="erwartet"]').first()).toContainText('6.500');
    await a.locator('[data-field="erzeugt"]').first().fill('6700');
    await expect(a.locator('.wf-status').first()).toHaveClass(/is-ok/);
    await page.locator('#wf-done').click();

    // Handel: nur Mengenbilanz, ohne Spalte "Erzeugung"
    await page.locator('#tk-warenfluss-new').click();
    await page.locator('[data-wf-new="handel"]').click();
    await expect(page.locator('.wf-section')).toHaveCount(1);
    await expect(sec(page, 'bilanz').locator('[data-field="zugang"]')).toHaveCount(0);
    await page.locator('#wf-done').click();

    // Liste im Termin mit vier Prüfungen und Zähler am Reiter
    await expect(page.locator('#tk-warenfluss-list .wf-list-row')).toHaveCount(4);
    await expect(page.locator('#kontrollmappe [data-km-tab="protokolle"] .km-tab-count')).toHaveText('4');
    await expect(page.locator('#tk-warenfluss-list')).toContainText('Imkerei');
  });

  test('Prüfung wieder öffnen und löschen', async ({ page }) => {
    const id = await openNew(page, 'handel');
    await sec(page, 'bilanz').locator('[data-field="produkt"]').first().fill('Bio-Haferflocken');
    await page.keyboard.press('Escape');
    await expect(page.locator('#warenfluss-overlay')).toBeHidden();
    await expect(page.locator('#kontrollmappe')).toBeVisible();
    await page.locator('#tk-warenfluss-list [data-wf-open]').first().click();
    await expect(sec(page, 'bilanz').locator('[data-field="produkt"]').first()).toHaveValue('Bio-Haferflocken');
    page.once('dialog', d => d.accept());
    await page.locator('#wf-delete').click();
    await expect(page.locator('#warenfluss-overlay')).toBeHidden();
    expect(await stored(page, id)).toHaveLength(0);
    await expect(page.locator('#tk-warenfluss-list .wf-list-row')).toHaveCount(0);
  });
});
