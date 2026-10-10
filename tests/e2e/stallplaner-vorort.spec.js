import { test, expect } from '@playwright/test';

// Vor-Ort-Bedienung des Stallplaners auf dem Handy: Touch, Hochformat,
// Maße direkt eintippen (siehe renderStallplanerChrome()/Aufgaben-Panels in
// main.js). Eigener Viewport statt eines zusätzlichen Playwright-Projekts —
// nur diese Datei braucht das Handy-Layout.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function openStallplanerWithNewPlan(page) {
  await page.goto('/');
  await page.locator('#btn-sidebar-toggle').click();
  await page.locator('.segment-btn[data-view="stallplaner"]').click();
  await page.locator('#stallplaner-start-new-plan').click();
  await expect(page.locator('#stallplaner-start-outline')).toBeVisible();
}

function planArea(plan, points) {
  const a = Math.abs(points.reduce((s, p, i) => {
    const n = points[(i + 1) % points.length];
    return s + (p.x * n.y - n.x * p.y);
  }, 0)) / 2;
  return a * plan.gridScale * plan.gridScale;
}

async function activePlan(page) {
  return page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
}

test.describe('Stallplaner vor Ort (Handy, Touch)', () => {
  test('Rechteck-Schnellstart: Länge × Breite mit Komma ergibt den Umriss und springt zu „Abteile"', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.locator('#stallplaner-start-card [data-act="rect-outline"]').tap();
    await page.locator('#stallplaner-rect-length').fill('24,5');
    await page.locator('#stallplaner-rect-width').fill('12');
    await page.locator('#stallplaner-rect-apply').tap();

    const plan = await activePlan(page);
    expect(plan.outline.points).toHaveLength(4);
    expect(planArea(plan, plan.outline.points)).toBeCloseTo(294, 5);
    await expect(page.locator('.stallplaner-step[data-step="abteile"]')).toHaveClass(/active/);
    await expect(page.locator('#stallplaner-sheet')).toBeHidden();
  });

  test('Rechteck ohne gültige Maße zeigt einen Hinweis statt etwas anzulegen', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.locator('#stallplaner-start-card [data-act="rect-outline"]').tap();
    await page.locator('#stallplaner-rect-length').fill('24,5');
    await page.locator('#stallplaner-rect-apply').tap();
    await expect(page.locator('#stallplaner-rect-error')).toBeVisible();
    expect((await activePlan(page)).outline).toBeNull();
  });

  test('Wand für Wand: L-förmiger Stall, letzte Wand wird automatisch ergänzt', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.locator('#stallplaner-start-card [data-act="walls-outline"]').tap();
    const walls = [['10,5', 'right'], ['4', 'down'], ['4,5', 'left'], ['3', 'down'], ['6', 'left']];
    for (const [len, dir] of walls) {
      await page.locator('#stallplaner-walls-length').fill(len);
      await page.locator(`#stallplaner-walls-pad [data-dir="${dir}"]`).tap();
    }
    await expect(page.locator('#stallplaner-walls-summary')).toContainText('5 Wände');
    await page.locator('#stallplaner-walls-close').tap();

    const plan = await activePlan(page);
    // 10,5 × 4 + 6 × 3 = 60 m², sechs Ecken (die fehlende Wand "7 m nach oben"
    // wurde ergänzt, kein doppelter Punkt am Start).
    expect(plan.outline.points).toHaveLength(6);
    expect(planArea(plan, plan.outline.points)).toBeCloseTo(60, 5);
    await expect(page.locator('#stallplaner-draw-hint')).toContainText('automatisch ergänzt');
  });

  test('Wand für Wand: „Letzte Wand" nimmt die Eingabe zurück, Rückwärts-Richtung wird abgelehnt', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.locator('#stallplaner-start-card [data-act="walls-outline"]').tap();
    await page.locator('#stallplaner-walls-length').fill('8');
    await page.locator('#stallplaner-walls-pad [data-dir="right"]').tap();
    await page.locator('#stallplaner-walls-length').fill('5');
    await page.locator('#stallplaner-walls-pad [data-dir="left"]').tap();
    await expect(page.locator('#stallplaner-walls-error')).toBeVisible();
    await expect(page.locator('#stallplaner-walls-summary')).toContainText('1 Wand');

    await page.locator('#stallplaner-walls-undo').tap();
    await expect(page.locator('#stallplaner-walls-summary')).toContainText('Noch keine Wand');
    await expect(page.locator('#stallplaner-walls-length')).toHaveValue('8');
  });

  test('In Buchten teilen: Breiten mit Rest und „Anzahl gleich breit"', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 24.5, y: 0 }, { x: 24.5, y: 12 }, { x: 0, y: 12 }]);
    });
    await page.locator('.stallplaner-step[data-step="abteile"]').tap();
    await page.locator('#stallplaner-actions [data-act="split"]').tap();
    await page.locator('#stallplaner-split-widths').fill('4; 4; 4,5');
    await page.locator('#stallplaner-split-apply').tap();

    let plan = await activePlan(page);
    expect(plan.compartments.map(c => Math.round(planArea(plan, c.points)))).toEqual([48, 48, 54, 144]);

    // Die letzte (Rest-)Bucht noch einmal in 3 gleich breite teilen.
    await page.evaluate(() => { document.querySelectorAll('.stallplan-compartment polygon')[3].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await expect(page.locator('#stallplaner-panel-selection')).toBeVisible();
    await page.locator('#stallplaner-panel-selection [data-card-act="split"]').tap();
    await page.locator('#stallplaner-split-count').fill('3');
    await page.locator('#stallplaner-split-apply').tap();

    plan = await activePlan(page);
    expect(plan.compartments).toHaveLength(6);
    expect(plan.compartments.slice(3).map(c => Math.round(planArea(plan, c.points)))).toEqual([48, 48, 48]);
  });

  test('Teilen mit zu großen Breiten zeigt einen Fehler', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]);
    });
    await page.locator('.stallplaner-step[data-step="abteile"]').tap();
    await page.locator('#stallplaner-actions [data-act="split"]').tap();
    await page.locator('#stallplaner-split-widths').fill('6; 6');
    await page.locator('#stallplaner-split-apply').tap();
    await expect(page.locator('#stallplaner-split-error')).toContainText('mehr als');
    expect((await activePlan(page)).compartments).toHaveLength(0);
  });

  test('Abteil antippen öffnet Details, Tierzahl schaltet die Öko-VO-Ampel', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }]);
      window.__ffTestStallplaner.addCompartment([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 5 }, { x: 0, y: 5 }], { name: 'Kuhbox' }); // 20 m²
    });
    const box = await page.locator('.stallplan-compartment polygon').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const sheet = page.locator('#stallplaner-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('#stallplaner-sheet-title')).toHaveText('Kuhbox');

    // Im Tiere-Schritt je Abteil Tiere hinzufügen: Tierart, Kategorie, Anzahl.
    await page.locator('.stallplaner-step[data-step="tiere"]').tap();
    await sheet.locator('.stallplan-tb-add').tap();
    await sheet.locator('.stallplan-tb-tierart').selectOption('rinder');
    await sheet.locator('.stallplan-tb-kategorie').selectOption('rind_milchkuh'); // 6 m²/Tier
    await sheet.locator('.stallplan-tb-anzahl').fill('3');
    await sheet.locator('.stallplan-tb-anzahl').dispatchEvent('change');
    await expect(sheet.locator('.stallplan-badge.ok')).toHaveCount(1);
    await sheet.locator('.stallplan-tb-anzahl').fill('4');
    await sheet.locator('.stallplan-tb-anzahl').dispatchEvent('change');
    await expect(sheet.locator('.stallplan-badge.fail')).toHaveCount(1);
    await expect(page.locator('.stallplaner-step[data-step="tiere"]')).toHaveClass(/done/);
  });

  test('Skizzieren per Touch: „Letzter Punkt" und „Fertig" statt Rechtsklick/Doppelklick', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.locator('#stallplaner-start-card [data-act="sketch-outline"]').tap();
    // Während des Skizzierens ersetzt die Leiste ihre Aktionen durch die Zeichen-Buttons.
    await expect(page.locator('#stallplaner-draw-finish')).toBeVisible();
    await expect(page.locator('#stallplaner-draw-undo-point')).toBeVisible();
    const svg = await page.locator('#stallplan-svg').boundingBox();
    const tapAt = (fx, fy) => page.touchscreen.tap(svg.x + svg.width * fx, svg.y + svg.height * fy);
    await tapAt(0.2, 0.3);
    await tapAt(0.8, 0.3);
    await tapAt(0.8, 0.6);
    await tapAt(0.5, 0.5); // Fehltipp
    await page.locator('#stallplaner-draw-undo-point').tap();
    await tapAt(0.2, 0.6);
    await page.locator('#stallplaner-draw-finish').tap();
    const plan = await activePlan(page);
    expect(plan.outline.points).toHaveLength(4);
    await expect(page.locator('.stallplaner-step[data-step="abteile"]')).toHaveClass(/active/);
  });

  test('Zwei-Finger-Pinch zoomt, Tipp danach setzt keinen Punkt', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]);
    });
    const widthOf = () => page.evaluate(() => parseFloat(document.getElementById('stallplan-svg').getAttribute('viewBox').split(' ')[2]));
    const before = await widthOf();
    await page.evaluate(() => {
      const svg = document.getElementById('stallplan-svg');
      const r = svg.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const ev = (type, id, x, y, target) => (target || document).dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true
      }));
      ev('pointerdown', 1, cx - 30, cy, svg);
      ev('pointerdown', 2, cx + 30, cy, svg);
      for (let i = 1; i <= 5; i++) {
        ev('pointermove', 1, cx - 30 - i * 20, cy);
        ev('pointermove', 2, cx + 30 + i * 20, cy);
      }
      ev('pointerup', 1, cx - 130, cy);
      ev('pointerup', 2, cx + 130, cy);
    });
    const after = await widthOf();
    expect(after).toBeLessThan(before * 0.6); // Fingerabstand 60 -> 260 px

    // Ein Klick unmittelbar nach dem Pinch (Browser feuert ihn teils noch)
    // darf nichts auslösen — hier: keine Auswahl.
    await page.evaluate(() => {
      document.querySelector('.stallplan-outline').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(page.locator('#stallplaner-sheet')).toBeHidden();
  });

  test('Vermessen hebt die aktuelle Kante sichtbar hervor, gemessene Kanten zeigen ihr Maß', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 0, y: 3 }]);
    });
    await page.locator('#stallplaner-tool-measure').tap();
    await page.evaluate(() => { document.querySelector('.stallplan-outline').dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    // Nicht nur vorhanden, sondern tatsächlich gezeichnet (Strichfarbe/-breite
    // aus dem Stylesheet) — ohne CSS-Regel wäre die Linie unsichtbar.
    const current = () => page.evaluate(() => {
      const el = document.querySelector('.stallplan-measure-highlight');
      const cs = getComputedStyle(el);
      return { stroke: cs.stroke, width: parseFloat(cs.strokeWidth), x1: +el.getAttribute('x1'), y1: +el.getAttribute('y1'), x2: +el.getAttribute('x2'), y2: +el.getAttribute('y2') };
    });
    let hl = await current();
    expect(hl.stroke).toBe('rgb(255, 182, 72)');
    expect(hl.width).toBeGreaterThanOrEqual(5);
    expect([hl.x1, hl.y1, hl.x2, hl.y2]).toEqual([0, 0, 5, 0]);
    await expect(page.locator('#stallplaner-draw-hint')).toContainText('Kante 1 von 4');

    await page.locator('#stallplaner-measure-input').fill('5,2');
    await page.locator('#stallplaner-measure-next').tap();
    hl = await current();
    expect([hl.x1, hl.y1, hl.x2, hl.y2]).toEqual([5, 0, 5, 3]);
    await expect(page.locator('.stallplan-measure-done')).toHaveCount(1);
    await expect(page.locator('.stallplan-measure-done-label')).toHaveText('5,20 m');
    await expect(page.locator('#stallplaner-draw-hint')).toContainText('Kante 2 von 4');

    await page.locator('#stallplaner-measure-cancel').tap();
    await expect(page.locator('.stallplan-measure-highlight')).toHaveCount(0);
  });

  test('Vermessen akzeptiert Komma-Eingaben', async ({ page }) => {
    await openStallplanerWithNewPlan(page);
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 0, y: 3 }]);
    });
    await page.locator('#stallplaner-tool-measure').tap();
    await page.evaluate(() => { document.querySelector('.stallplan-outline').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    for (const len of ['8,5', '4', '8,5', '4']) {
      await page.locator('#stallplaner-measure-input').fill(len);
      await page.locator('#stallplaner-measure-next').tap();
    }
    const plan = await activePlan(page);
    expect(planArea(plan, plan.outline.points)).toBeCloseTo(34, 1);
  });
});
