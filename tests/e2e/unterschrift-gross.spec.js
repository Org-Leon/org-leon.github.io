import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Unterschriftenfelder der Protokolle als großes Popout: gleiches
// Seitenverhältnis wie das kleine Feld, Übernehmen/Abbrechen/Löschen,
// Escape schließt nur das Popout.
async function openProtokoll(page) {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  await page.evaluate(() => window.__ffTestTk.loginFake());
  await gotoKontrolleKalender(page);
  const id = await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Musterhof GmbH' }));
  await openFirstTermin(page, 'protokolle');
  await page.locator('#tk-probenprotokoll-new').click();
  await expect(page.locator('#probenprotokoll-modal-overlay')).toBeVisible();
  return id;
}
// Strich per Pointer-Events (Leaflet-unabhängig, wie konto.spec.js).
const draw = (page, selector) => page.locator(selector).evaluate((c) => {
  const r = c.getBoundingClientRect();
  const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true }));
  ev('pointerdown', 0.1, 0.6); ev('pointermove', 0.3, 0.3); ev('pointermove', 0.5, 0.7); ev('pointermove', 0.8, 0.4); ev('pointerup', 0.8, 0.4);
});
const sig = (page, id) => page.evaluate((evId) => {
  const T = window.__ffTestProbenprotokoll;
  return T.get(evId, T.getActive().id).signatureProbenehmer;
}, id);
const imgSize = (page, dataUrl) => page.evaluate((src) => new Promise(res => { const i = new Image(); i.onload = () => res([i.width, i.height]); i.src = src; }), dataUrl);
const inkPixels = (page, selector) => page.locator(selector).evaluate((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});

test.describe('Unterschrift groß (Popout)', () => {
  test('groß unterschreiben und übernehmen — Ergebnis im kleinen Feld, höhere Auflösung, gleiches Seitenverhältnis', async ({ page }) => {
    const id = await openProtokoll(page);
    const block = page.locator('.pp-signature-block').first();
    await block.locator('.pp-signature-big').click();
    const ov = page.locator('#sigpad-overlay');
    await expect(ov).toBeVisible();
    await expect(page.locator('#sigpad-title')).toHaveText('Unterschrift des Probenehmers');
    await expect(page.locator('#sigpad-sub')).toHaveText('Musterhof GmbH');
    await expect(page.locator('#sigpad-empty')).toBeVisible();

    // Deutlich größer als das kleine Feld, gleiches Seitenverhältnis
    const big = await page.locator('#sigpad-canvas').boundingBox();
    const small = await page.locator('#pp-sig-probenehmer').boundingBox();
    expect(big.width).toBeGreaterThan(small.width * 1.8);
    expect(big.width / big.height).toBeCloseTo(480 / 140, 1);

    await draw(page, '#sigpad-canvas');
    await expect(page.locator('#sigpad-empty')).toBeHidden();
    expect(await sig(page, id)).toBeFalsy(); // erst beim Übernehmen
    await page.locator('#sigpad-apply').click();
    await expect(ov).toBeHidden();

    const data = await sig(page, id);
    expect(data).toMatch(/^data:image\/png/);
    expect(await imgSize(page, data)).toEqual([960, 280]);
    await expect.poll(() => inkPixels(page, '#pp-sig-probenehmer')).toBeGreaterThan(50);
    // Pflichtfeld-Markierung verschwindet
    await expect(block).not.toHaveClass(/pp-invalid/);
  });

  test('Abbrechen und Escape lassen die Unterschrift unverändert; Löschen + Übernehmen entfernt sie', async ({ page }) => {
    const id = await openProtokoll(page);
    const bigBtn = page.locator('.pp-signature-block').first().locator('.pp-signature-big');
    await bigBtn.click();
    await draw(page, '#sigpad-canvas');
    await page.locator('#sigpad-apply').click();
    const first = await sig(page, id);

    // Popout zeigt die vorhandene Unterschrift; Abbrechen ändert nichts
    await bigBtn.click();
    await expect(page.locator('#sigpad-empty')).toBeHidden();
    await expect.poll(() => inkPixels(page, '#sigpad-canvas')).toBeGreaterThan(50);
    await page.locator('#sigpad-clear').click();
    await expect(page.locator('#sigpad-empty')).toBeVisible();
    await page.locator('#sigpad-cancel').click();
    expect(await sig(page, id)).toBe(first);

    // Escape schließt nur das Popout, das Protokoll bleibt offen
    await bigBtn.click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sigpad-overlay')).toBeHidden();
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeVisible();
    expect(await sig(page, id)).toBe(first);

    // Löschen + Übernehmen
    await bigBtn.click();
    await page.locator('#sigpad-clear').click();
    await page.locator('#sigpad-apply').click();
    expect(await sig(page, id)).toBeNull();
    await expect.poll(() => inkPixels(page, '#pp-sig-probenehmer')).toBe(0);
  });

  test('am Handy hochkant: Vollbild mit Hinweis zum Querhalten', async ({ page }) => {
    await openProtokoll(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.pp-signature-block').first().locator('.pp-signature-big').click();
    await expect(page.locator('.sigpad-rotate-hint')).toBeVisible();
    const card = await page.locator('.sigpad-card').boundingBox();
    expect(card.width).toBeGreaterThanOrEqual(388);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('.sigpad-rotate-hint')).toBeHidden();
    const big = await page.locator('#sigpad-canvas').boundingBox();
    expect(big.width).toBeGreaterThan(600);
  });
});
