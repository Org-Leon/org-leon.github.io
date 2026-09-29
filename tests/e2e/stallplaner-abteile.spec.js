import { test, expect } from '@playwright/test';
import { gotoTab } from './helpers.js';

// Abteile leichter anlegen (main.js "Zeichenhilfen für Abteile"):
//   * Abteile sind optional — "Ganzer Stall" nimmt den Umriss als Fläche
//   * Einrasten an Ecken/Wänden/Achsen beim Zeichnen
//   * Abteile werden auf Stallwand/Nachbarabteile zugeschnitten
//   * "Restfläche" legt die noch freie Fläche als Abteil an
//   * Tierart je Tier-Zeile statt für den ganzen Stall
const OUTLINE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }]; // 80 m²

const area = (pts) => Math.abs(pts.reduce((s, p, i) => {
  const n = pts[(i + 1) % pts.length];
  return s + (p.x * n.y - n.x * p.y);
}, 0)) / 2;

async function activePlan(page) {
  return page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
}

// Klick auf einen Plan-Punkt, optional um dx/dy Bildschirm-Pixel versetzt.
async function clickPlanPoints(page, points) {
  await page.evaluate((pts) => {
    const svg = document.getElementById('stallplan-svg');
    pts.forEach(([x, y, dx = 0, dy = 0]) => {
      const c = window.__ffTestStallplaner.clientPoint(x, y);
      svg.dispatchEvent(new MouseEvent('click', { clientX: c.x + dx, clientY: c.y + dy, bubbles: true }));
    });
  }, points);
}
async function finishDraw(page) {
  await page.locator('#stallplaner-draw-finish').click();
}

test.describe('Stallplaner: Abteile anlegen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Stallplaner');
    await page.locator('#stallplaner-new-plan').click();
    await page.evaluate((o) => window.__ffTestStallplaner.setOutline(o), OUTLINE);
    await page.locator('.stallplaner-step[data-step="abteile"]').click();
  });

  test('„Ganzer Stall“ ohne Abteile: Umriss wird die Fläche und folgt Änderungen am Umriss', async ({ page }) => {
    const btn = page.locator('.stallplaner-act[data-act="whole-stall"]');
    await expect(btn).toBeVisible();
    await btn.click();

    let plan = await activePlan(page);
    expect(plan.compartments).toHaveLength(1);
    expect(plan.compartments[0].wholeStall).toBe(true);
    expect(plan.compartments[0].name).toBe('Ganzer Stall');
    expect(area(plan.compartments[0].points)).toBeCloseTo(80, 5);
    // Direkt weiter zu den Tieren.
    await expect(page.locator('.stallplaner-step[data-step="tiere"]')).toHaveClass(/active/);

    // Umriss nachträglich vermessen/geändert -> "Ganzer Stall" zieht mit.
    await page.evaluate(() => window.__ffTestStallplaner.setVertex('outline', null, 1, 12, 0));
    await page.evaluate(() => window.__ffTestStallplaner.setVertex('outline', null, 2, 12, 8));
    plan = await activePlan(page);
    expect(area(plan.compartments[0].points)).toBeCloseTo(96, 5);

    // Doch in Buchten teilen -> "Ganzer Stall" (ohne Tiere) macht wortlos Platz.
    await page.locator('.stallplaner-step[data-step="abteile"]').click();
    await expect(btn).toBeHidden();
    await page.locator('.stallplaner-act[data-act="split"]').click();
    await page.locator('#stallplaner-split-count').fill('3');
    await page.locator('#stallplaner-split-apply').click();
    plan = await activePlan(page);
    expect(plan.compartments).toHaveLength(3);
    expect(plan.compartments.some(c => c.wholeStall)).toBe(false);
  });

  test('„Ganzer Stall“ mit Tieren wird nur nach Rückfrage durch Abteile ersetzt', async ({ page }) => {
    await page.locator('.stallplaner-act[data-act="whole-stall"]').click();
    await page.locator('.stallplan-tb-add').first().click();
    await page.locator('.stallplan-tb-tierart').first().selectOption('schweine');

    await page.locator('.stallplaner-step[data-step="abteile"]').click();
    await page.locator('.stallplaner-act[data-act="split"]').click();
    await page.locator('#stallplaner-split-count').fill('2');
    page.once('dialog', d => d.dismiss());
    await page.locator('#stallplaner-split-apply').click();
    let plan = await activePlan(page);
    expect(plan.compartments).toHaveLength(1);
    expect(plan.compartments[0].wholeStall).toBe(true);

    page.once('dialog', d => d.accept());
    await page.locator('#stallplaner-split-apply').click();
    plan = await activePlan(page);
    expect(plan.compartments).toHaveLength(2);
  });

  test('Beim Skizzieren rasten Punkte an Wänden und Ecken des Umrisses ein', async ({ page }) => {
    await page.locator('.stallplaner-act[data-act="add-compartment"]').click();
    await page.locator('#stallplaner-tool-compartment').click();
    // Knapp neben die obere/untere Wand (8 px daneben) und nah an Ecken.
    await clickPlanPoints(page, [[3, 0, 3, 8], [3, 8, -4, -8], [0, 8, 6, -5], [0, 0, 5, 6]]);
    await expect(page.locator('.stallplan-snap-mark')).toHaveCount(1);
    await finishDraw(page);

    const plan = await activePlan(page);
    expect(plan.compartments).toHaveLength(1);
    expect(plan.compartments[0].points).toEqual([{ x: 3, y: 0 }, { x: 3, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 0 }]);
    expect(area(plan.compartments[0].points)).toBeCloseTo(24, 5);
  });

  test('Einrasten: waagerecht/senkrecht zum vorherigen Punkt, Wand vor Raster', async ({ page }) => {
    const r = await page.evaluate(() => {
      const t = window.__ffTestStallplaner;
      return {
        // Mitten im Stall, knapp unter der Höhe des vorherigen Punkts -> exakt gleiche Höhe
        axis: t.snap({ x: 6.3, y: 4.04 }, { prev: { x: 2, y: 4 } }),
        // Knapp neben der rechten Wand -> auf die Wand, entlang der Wand aufs Raster
        edge: t.snap({ x: 9.97, y: 3.2 }),
        corner: t.snap({ x: 9.98, y: 7.97 })
      };
    });
    expect(r.axis.kind).toBe('axis');
    expect(r.axis.point.y).toBe(4);
    expect(r.edge.kind).toBe('edge');
    expect(r.edge.point).toEqual({ x: 10, y: 3 });
    expect(r.corner.kind).toBe('vertex');
    expect(r.corner.point).toEqual({ x: 10, y: 8 });
  });

  test('Über die Stallwand gezeichnetes Abteil wird auf den Umriss zugeschnitten', async ({ page }) => {
    await page.locator('.stallplaner-act[data-act="add-compartment"]').click();
    await page.locator('#stallplaner-tool-compartment').click();
    await clickPlanPoints(page, [[7, 2], [13, 2], [13, 6], [7, 6]]);
    await finishDraw(page);
    const plan = await activePlan(page);
    expect(plan.compartments).toHaveLength(1);
    expect(area(plan.compartments[0].points)).toBeCloseTo(12, 5); // 3 × 4 statt 6 × 4
    expect(Math.max(...plan.compartments[0].points.map(p => p.x))).toBeCloseTo(10, 5);
    await expect(page.locator('#stallplaner-draw-hint')).toContainText('angepasst');
  });

  test('Überlappung mit einem Nachbarabteil wird abgezogen', async ({ page }) => {
    await page.evaluate(() => window.__ffTestStallplaner.addCompartment([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 8 }, { x: 0, y: 8 }]));
    const fitted = await page.evaluate(() => window.__ffTestStallplaner.fitCompartment([{ x: 3, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 6 }, { x: 3, y: 6 }]));
    expect(fitted.adjusted).toBe(true);
    expect(area(fitted.points)).toBeCloseTo(12, 5); // nur x 5..8
    // Komplett auf belegter Fläche -> nichts übrig
    const none = await page.evaluate(() => window.__ffTestStallplaner.fitCompartment([{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }, { x: 1, y: 4 }]));
    expect(none).toBeNull();
  });

  test('„Restfläche“ legt die noch freie Stallfläche als Abteil an', async ({ page }) => {
    const rest = page.locator('.stallplaner-act[data-act="rest-area"]');
    await expect(rest).toBeHidden(); // ohne Abteile gibt es keinen "Rest"
    await page.evaluate(() => window.__ffTestStallplaner.addCompartment([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 8 }]));
    await expect(rest).toBeVisible();
    await rest.click();
    const plan = await activePlan(page);
    expect(plan.compartments).toHaveLength(2);
    expect(plan.compartments[1].name).toBe('Restfläche');
    expect(area(plan.compartments[1].points)).toBeCloseTo(32, 5);
    await expect(rest).toBeHidden();
  });
});

test.describe('Stallplaner: Tierart je Bucht', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Stallplaner');
    await page.locator('#stallplaner-new-plan').click();
  });

  test('Verschiedene Tierarten in verschiedenen Buchten und in einer Bucht', async ({ page }) => {
    await page.evaluate((o) => {
      window.__ffTestStallplaner.setOutline(o);
      window.__ffTestStallplaner.addCompartment([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 8 }, { x: 0, y: 8 }], { name: 'Bucht Rinder' });
      window.__ffTestStallplaner.addCompartment([{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 5, y: 8 }], { name: 'Bucht gemischt' });
    }, OUTLINE);
    // Es gibt keine Tierart mehr für den ganzen Plan.
    await expect(page.locator('#stallplaner-tierart-select')).toHaveCount(0);

    const cardA = page.locator('#stallplaner-abteile-list .stallplan-abteil-row').nth(0);
    const cardB = page.locator('#stallplaner-abteile-list .stallplan-abteil-row').nth(1);
    await expect(cardA.locator('.stallplan-tb-add')).toBeEnabled();
    await expect(cardA.locator('.stallplan-tb-add')).toContainText('Tiere');

    await cardA.locator('.stallplan-tb-add').click();
    await cardA.locator('.stallplan-tb-tierart').selectOption('rinder');
    await cardA.locator('.stallplan-tb-kategorie').selectOption('rind_milchkuh');

    await cardB.locator('.stallplan-tb-add').click();
    // Vorschlag: im Stall häufigste Tierart — frei änderbar
    await expect(cardB.locator('.stallplan-tb-tierart')).toHaveValue('rinder');
    await cardB.locator('.stallplan-tb-tierart').selectOption('schafe_ziegen');
    await cardB.locator('.stallplan-tb-kategorie').selectOption('schaf_adult');
    await cardB.locator('.stallplan-tb-add').click();
    await expect(cardB.locator('.stallplan-tb-tierart').nth(1)).toHaveValue('schafe_ziegen');
    await cardB.locator('.stallplan-tb-tierart').nth(1).selectOption('pferde');
    // Kategorien passen immer zur Tierart der Zeile
    const pferdOptions = await cardB.locator('.stallplan-tb-kategorie').nth(1).locator('option').allTextContents();
    expect(pferdOptions.some(o => o.startsWith('Pferde'))).toBe(true);
    expect(pferdOptions.some(o => o.includes('Schafe'))).toBe(false);
    await cardB.locator('.stallplan-tb-kategorie').nth(1).selectOption('pferd_adult');

    const plan = await activePlan(page);
    expect(plan.compartments[0].tierbestand.map(tb => tb.tierart)).toEqual(['rinder']);
    expect(plan.compartments[1].tierbestand.map(tb => [tb.tierart, tb.kategorieId])).toEqual([
      ['schafe_ziegen', 'schaf_adult'], ['pferde', 'pferd_adult']
    ]);
  });

  test('Tierart wechseln setzt eine nicht mehr passende Kategorie zurück', async ({ page }) => {
    await page.evaluate((o) => {
      window.__ffTestStallplaner.setOutline(o);
      window.__ffTestStallplaner.addCompartment([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 8 }, { x: 0, y: 8 }]);
    }, OUTLINE);
    const card = page.locator('#stallplaner-abteile-list .stallplan-abteil-row').first();
    await card.locator('.stallplan-tb-add').click();
    await expect(card.locator('.stallplan-tb-kategorie')).toBeDisabled(); // erst Tierart
    await card.locator('.stallplan-tb-tierart').selectOption('rinder');
    await card.locator('.stallplan-tb-kategorie').selectOption('rind_kalb');
    await card.locator('.stallplan-tb-tierart').selectOption('schweine');
    await expect(card.locator('.stallplan-tb-kategorie')).toHaveValue('');
  });

  test('Ältere Pläne mit einer Tierart für den ganzen Stall werden übernommen', async ({ page }) => {
    const restored = await page.evaluate(() => {
      window.__ffTestStallplaner.restoreStallplaene([{
        id: 'alt', name: 'Alter Plan', tierart: 'rinder', gridScale: 1, gridSnap: true,
        outline: { points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] },
        compartments: [{ id: 'a1', name: 'A1', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
          tierbestand: [{ id: 't1', kategorieId: 'rind_kalb', tieranzahl: 2 }, { id: 't2', kategorieId: null, tieranzahl: 0 }] }],
        equipment: []
      }]);
      return window.__ffTestStallplaner.serializeStallplaene()[0].compartments[0].tierbestand.map(tb => tb.tierart);
    });
    expect(restored).toEqual(['rinder', 'rinder']);
  });
});
