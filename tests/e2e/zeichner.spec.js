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

  test('Rückgängig entfernt zuletzt gezeichnete Fläche wieder, Wiederherstellen bringt sie zurück', async ({ page }) => {
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(1);
    await expect(page.locator('#shape-tool-undo')).toBeEnabled();
    await expect(page.locator('#shape-tool-redo')).toBeDisabled();
    await page.locator('#shape-tool-undo').click();
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(0);
    await expect(page.locator('#shape-tool-redo')).toBeEnabled();
    await page.locator('#shape-tool-redo').click();
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(1);
  });

  test('Wiederherstellen nach Löschen bringt die Fläche zurück', async ({ page }) => {
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await page.locator('#shape-tool-delete').click();
    await page.evaluate(() => {
      const map = window.__ffTestMap;
      let target = null;
      map.eachLayer((l) => { if (l instanceof window.L.Polygon && !target) target = l; });
      target.fire('click');
    });
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(0);
    await page.locator('#shape-tool-undo').click();
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(1);
    await page.locator('#shape-tool-redo').click();
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(0);
  });

  test('Eine neue Aktion nach Rückgängig verwirft die Redo-Historie', async ({ page }) => {
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await page.locator('#shape-tool-undo').click();
    await expect(page.locator('#shape-tool-redo')).toBeEnabled();
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await expect(page.locator('#shape-tool-redo')).toBeDisabled();
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

  test('Klick auf eine selbst gezeichnete Fläche von einem anderen Tab aus wechselt direkt in den Flächenzeichner', async ({ page }) => {
    await drawZeichnerPolygon(page, TEST_POLY_A);
    // Gezeichnete Flächen landen als ganz normale Ebene in der geteilten
    // layers-Liste und sind daher auch im Viewer sichtbar/anklickbar.
    await page.locator('.segment-btn.active').click(); // zurück zum Viewer
    await page.evaluate(() => {
      const map = window.__ffTestMap;
      let target = null;
      map.eachLayer((l) => { if (l instanceof window.L.Polygon && !target) target = l; });
      target.fire('click');
    });
    await expect(page.locator('.segment-btn[data-view="zeichner"]')).toHaveClass(/active/);
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(1);
  });
});

// Ein Klick auf eine selbst gezeichnete Fläche sprang früher immer in den
// Flächenzeichner — auch im Obstbaumkataster/in der Bienenflugkarte, wo er
// einen Baum bzw. Bienenstock setzen soll (der Wechsel setzte das Werkzeug
// zurück, bevor der Baum entstand).
test.describe('Gezeichnete Flächen in anderen Funktionen', () => {
  async function drawAndShow(page) {
    await page.goto('/');
    await gotoTab(page, 'Flächenzeichner');
    await drawZeichnerPolygon(page, TEST_POLY_A);
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(1);
    await page.evaluate((poly) => window.__ffTestMap.fitBounds(poly, { animate: false }), TEST_POLY_A);
  }
  // Echter Mausklick mitten in die Fläche (Flächen- UND Karten-Klick feuern).
  // Flächen liegen auf einem Canvas (renderer: L.canvas()) — Position daher
  // über die Karte berechnet statt über ein DOM-Element.
  async function clickIntoParcel(page, dx = 0) {
    const pt = await page.evaluate((poly) => {
      const map = window.__ffTestMap;
      const center = window.L.latLngBounds(poly).getCenter();
      const p = map.latLngToContainerPoint(center);
      const rect = document.getElementById('map').getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    }, TEST_POLY_A);
    await page.mouse.click(pt.x + dx, pt.y);
  }

  test('Obstbaum: Baum lässt sich auf eine gezeichnete Fläche setzen', async ({ page }) => {
    await drawAndShow(page);
    await gotoTab(page, 'Obstbaumkataster');
    await page.locator('.fruit-btn').first().click();
    await clickIntoParcel(page);
    await expect(page.locator('.tree-marker-icon')).toHaveCount(1);
    await expect(page.locator('.segment-btn[data-view="obstbaum"]')).toHaveClass(/active/);
    await expect(page.locator('.fruit-btn.active')).toHaveCount(1); // Setzen bleibt aktiv
    await clickIntoParcel(page, 40); // daneben — ein Klick auf den Baum selbst öffnet dessen Details
    await expect(page.locator('.tree-marker-icon')).toHaveCount(2);
  });

  test('Bienenflug: Bienenstock lässt sich auf eine gezeichnete Fläche setzen', async ({ page }) => {
    await drawAndShow(page);
    await gotoTab(page, 'Bienenflugkarte');
    await clickIntoParcel(page);
    await expect(page.locator('#bienenflug-list > *')).toHaveCount(1);
    await expect(page.locator('.segment-btn[data-view="bienenflug"]')).toHaveClass(/active/);
  });

  test('In der Ansicht „Karte“ öffnet ein Klick auf die Fläche weiterhin den Flächenzeichner', async ({ page }) => {
    await drawAndShow(page);
    await page.locator('.segment-btn[data-view="viewer"]').click();
    await clickIntoParcel(page);
    await expect(page.locator('.segment-btn[data-view="zeichner"]')).toHaveClass(/active/);
  });
});
