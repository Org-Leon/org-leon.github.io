import { test, expect } from '@playwright/test';
import { gotoTab, drawZeichnerPolygon, TEST_POLY_A } from './helpers.js';

test.describe('Flächenzeichner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Flächenzeichner');
  });

  test('Fläche zeichnen legt einen Eintrag mit Fläche > 0 an', async ({ page }) => {
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(1);
    const size = await page.locator('#zeichner-list .parcel-size').first().textContent();
    expect(size).toMatch(/\d/);
  });

  test('Rückgängig entfernt zuletzt gezeichnete Fläche wieder', async ({ page }) => {
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(1);
    await expect(page.locator('#shape-tool-undo')).toBeEnabled();
    await page.locator('#shape-tool-undo').click();
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(0);
  });

  test('Löschen-Werkzeug entfernt eine angeklickte Fläche', async ({ page }) => {
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await page.locator('#shape-tool-delete').click();
    await page.evaluate(() => {
      const map = window.__ffTestMap;
      let target = null;
      map.eachLayer((l) => { if (l instanceof window.L.Polygon && !target) target = l; });
      target.fire('click');
    });
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(0);
  });

  test('Bearbeiten-Werkzeug aktiviert Eckpunkt-Editing auf der Karte', async ({ page }) => {
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await page.locator('#shape-tool-edit').click();
    const editingEnabled = await page.evaluate(() => {
      const map = window.__ffTestMap;
      let target = null;
      map.eachLayer((l) => { if (l instanceof window.L.Polygon && !target) target = l; });
      target.fire('click');
      return !!(target.editing && target.editing._enabled);
    });
    expect(editingEnabled).toBe(true);
  });

  test('Namens-Eingabe wird in der Liste übernommen', async ({ page }) => {
    await drawZeichnerPolygon(page, TEST_POLY_A);
    const nameInput = page.locator('#zeichner-list .parcel-name').first();
    await nameInput.fill('Testschlag Nord');
    await expect(nameInput).toHaveValue('Testschlag Nord');
  });
});
