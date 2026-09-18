import { test, expect } from '@playwright/test';
import { gotoTab, drawHofplanRect, drawHofplanPolygon, TEST_RECT_A, TEST_POLY_A } from './helpers.js';

test.describe('Hofplan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Hofplan');
  });

  test('Rechteck zeichnen legt ein Gebäude mit Standardfarbe an', async ({ page }) => {
    await drawHofplanRect(page, TEST_RECT_A);
    await expect(page.locator('#hofplan-list .parcel-item')).toHaveCount(1);
    const color = await page.locator('.hofplan-color-input').first().inputValue();
    expect(color.toLowerCase()).toBe('#7d7d7d');
  });

  test('Freiform-Polygon zeichnen legt ebenfalls ein Gebäude an', async ({ page }) => {
    await drawHofplanPolygon(page, TEST_POLY_A);
    await expect(page.locator('#hofplan-list .parcel-item')).toHaveCount(1);
  });

  test('Gebäudetyp-Auswahl ändert Farbe von Swatch und Kartenformen', async ({ page }) => {
    await drawHofplanRect(page, TEST_RECT_A);
    await page.locator('#hofplan-list .parcel-kultur').selectOption('Maschinenhalle');
    const mapColor = await page.evaluate(() => {
      const map = window.__ffTestMap;
      let target = null;
      map.eachLayer((l) => { if (l instanceof window.L.Rectangle && !target) target = l; });
      return target.options.color;
    });
    expect(mapColor.toUpperCase()).toBe('#4A6FA5');
  });

  test('Eigene Farbe überschreibt die Kategorie-Farbe, Zurücksetzen stellt sie wieder her', async ({ page }) => {
    await drawHofplanRect(page, TEST_RECT_A);
    await page.locator('#hofplan-list .parcel-kultur').selectOption('Stall');
    const colorInput = page.locator('.hofplan-color-input').first();
    await colorInput.fill('#00aaff');
    await colorInput.dispatchEvent('change');
    await expect(page.locator('[data-action="reset-color"]')).toBeVisible();
    await page.locator('[data-action="reset-color"]').click();
    await expect(page.locator('.hofplan-color-input').first()).toHaveValue('#6e5b3e');
    await expect(page.locator('[data-action="reset-color"]')).toHaveCount(0);
  });

  test('Rückgängig macht das Zeichnen wieder rückgängig, Wiederherstellen bringt es zurück', async ({ page }) => {
    await drawHofplanRect(page, TEST_RECT_A);
    await expect(page.locator('#hofplan-tool-undo')).toBeEnabled();
    await expect(page.locator('#hofplan-tool-redo')).toBeDisabled();
    await page.locator('#hofplan-tool-undo').click();
    await expect(page.locator('#hofplan-list .parcel-item')).toHaveCount(0);
    await expect(page.locator('#hofplan-tool-redo')).toBeEnabled();
    await page.locator('#hofplan-tool-redo').click();
    await expect(page.locator('#hofplan-list .parcel-item')).toHaveCount(1);
  });

  test('Löschen und Rückgängig-Machen des Löschens stellt das Gebäude wieder her, Wiederherstellen löscht erneut', async ({ page }) => {
    await drawHofplanRect(page, TEST_RECT_A);
    await page.locator('#hofplan-tool-delete').click();
    await page.evaluate(() => {
      const map = window.__ffTestMap;
      let target = null;
      map.eachLayer((l) => { if (l instanceof window.L.Rectangle && !target) target = l; });
      target.fire('click');
    });
    await expect(page.locator('#hofplan-list .parcel-item')).toHaveCount(0);
    await page.locator('#hofplan-tool-undo').click();
    await expect(page.locator('#hofplan-list .parcel-item')).toHaveCount(1);
    await page.locator('#hofplan-tool-redo').click();
    await expect(page.locator('#hofplan-list .parcel-item')).toHaveCount(0);
  });

  test('Lageplan-Export mit benanntem Gebäude liefert eine gültige PDF-Datei', async ({ page }) => {
    await drawHofplanRect(page, TEST_RECT_A);
    await page.locator('#hofplan-list .parcel-name').fill('Halle Nord');
    await page.locator('#hofplan-list .parcel-kultur').selectOption('Maschinenhalle');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('#btn-export-hofplan-uebersicht').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const path = await download.path();
    expect(path).toBeTruthy();
  });
});
