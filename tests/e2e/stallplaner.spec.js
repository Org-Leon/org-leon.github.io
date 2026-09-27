import { test, expect } from '@playwright/test';
import { gotoTab } from './helpers.js';

// Rohes SVG-Pointer-Zeichnen (Umriss/Abteile) lässt sich, genau wie
// Leaflet.draw (siehe AGENTS.md Punkt 2), nicht zuverlässig über simulierte
// Maus-Drag-Gesten auslösen — Klicks auf feste Punkte funktionieren aber
// zuverlässig (dispatcht echte 'click'-Events auf #stallplan-svg, läuft
// durch dieselbe Zeichnen-Zustandsmaschine wie ein echter Nutzer-Klick).
// Für alles, was Drag braucht (Vertex-Verschieben), wird stattdessen der
// dev-only Testhaken window.__ffTestStallplaner genutzt.
async function clickSvgPoints(page, points) {
  await page.evaluate((pts) => {
    const svg = document.getElementById('stallplan-svg');
    const rect = svg.getBoundingClientRect();
    pts.forEach(([fx, fy]) => {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      svg.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
    });
  }, points);
}
async function finishDrawWithDblClick(page, fx, fy) {
  await page.evaluate(([x0, y0]) => {
    const svg = document.getElementById('stallplan-svg');
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent('dblclick', {
      clientX: rect.left + rect.width * x0, clientY: rect.top + rect.height * y0, bubbles: true
    }));
  }, [fx, fy]);
}
async function rightClickSvg(page, fx, fy) {
  await page.evaluate(([x0, y0]) => {
    const svg = document.getElementById('stallplan-svg');
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: rect.left + rect.width * x0, clientY: rect.top + rect.height * y0, bubbles: true, cancelable: true
    }));
  }, [fx, fy]);
}
// Klick auf ein konkretes Element (z.B. eine Ausstattungs-Fläche/-Linie)
// statt auf eine grobe Bildschirm-Fraktion — wichtig für Elemente mit
// eigenen Kind-Elementen: ein synthetisches Event direkt auf #stallplan-svg
// zu feuern würde NICHT durch deren Ebenen hindurch nach oben blubbern
// (es startet ja erst am SVG-Wurzelelement selbst), ein Klick auf das
// tatsächlich getroffene Element dagegen schon.
async function clickSelector(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    document.elementFromPoint(cx, cy).dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, bubbles: true }));
  }, selector);
}

// Die untere Aktionsleiste zeigt nur die Werkzeuge des aktuellen Schritts
// (siehe renderStallplanerChrome() in main.js).
async function gotoStep(page, step) {
  await page.locator(`.stallplaner-step[data-step="${step}"]`).click();
}

test.describe('Stallplaner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Stallplaner');
    await page.locator('#stallplaner-new-plan').click();
  });

  test('Umriss zeichnen berechnet die Fläche korrekt', async ({ page }) => {
    await page.locator('button[data-tool="draw-outline"]').click();
    await clickSvgPoints(page, [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6], [0.2, 0.6]]);
    await finishDrawWithDblClick(page, 0.2, 0.6);
    await expect(page.locator('.stallplan-outline')).toHaveCount(1);
    await expect(page.locator('#stallplaner-total-area')).toContainText('Umriss');
    // Zeichenwerkzeug ist nach Abschluss nicht mehr "scharf".
    await expect(page.locator('button[data-tool="draw-outline"]')).not.toHaveClass(/active/);
  });

  test('Klick nah am Startpunkt schließt den Umriss ohne Enter/Doppelklick', async ({ page }) => {
    await page.locator('button[data-tool="draw-outline"]').click();
    await clickSvgPoints(page, [[0.3, 0.3], [0.6, 0.3], [0.6, 0.6], [0.2, 0.6]]);
    // Exakt auf den sichtbaren ersten Punkt klicken (nicht nur eine grob
    // genäherte Bildschirm-Koordinate) — der gezeichnete Punkt selbst kann
    // durch Raster-Snap leicht von der rohen Klick-Fraktion abweichen.
    const startDot = page.locator('.stallplan-draw-point').first();
    const box = await startDot.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.stallplan-outline')).toHaveCount(1);
    await expect(page.locator('button[data-tool="draw-outline"]')).not.toHaveClass(/active/);
    const plan = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
    expect(plan.outline.points).toHaveLength(4); // der schließende Klick wurde NICHT als 5. Punkt übernommen
  });

  test('Rechtsklick macht beim Zeichnen den zuletzt gesetzten Punkt rückgängig', async ({ page }) => {
    await page.locator('button[data-tool="draw-outline"]').click();
    await clickSvgPoints(page, [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6]]);
    await rightClickSvg(page, 0.6, 0.6); // letzten Punkt (0.6, 0.6) wieder entfernen
    await clickSvgPoints(page, [[0.2, 0.6]]); // stattdessen diesen Punkt setzen
    await finishDrawWithDblClick(page, 0.2, 0.6);
    await expect(page.locator('.stallplan-outline')).toHaveCount(1);
    const plan = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
    expect(plan.outline.points).toHaveLength(3); // (0.2,0.2)/(0.6,0.2)/(0.2,0.6) — nicht die verworfene (0.6,0.6)
  });

  test('Abteil mit Kategorie/Tierzahl zeigt Compliance-Badge, kippt an der Grenze', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }]);
      window.__ffTestStallplaner.addCompartment(
        [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 6 }, { x: 1, y: 6 }] // 4x5 = 20 m²
      );
    });
    await page.locator('#stallplaner-tierart-select').selectOption('rinder');
    await page.locator('.stallplan-tb-add').click();
    await page.locator('.stallplan-tb-kategorie').selectOption('rind_milchkuh'); // 6 m²/Tier
    // 3 Milchkühe -> 18 m² benötigt, 20 m² vorhanden -> konform
    await page.locator('.stallplan-tb-anzahl').fill('3');
    await page.locator('.stallplan-tb-anzahl').dispatchEvent('change');
    await expect(page.locator('.stallplan-badge.ok')).toHaveCount(1);
    await expect(page.locator('.stallplan-compartment.non-compliant')).toHaveCount(0);

    // 4 Milchkühe -> 24 m² benötigt, 20 m² vorhanden -> nicht mehr konform
    await page.locator('.stallplan-tb-anzahl').fill('4');
    await page.locator('.stallplan-tb-anzahl').dispatchEvent('change');
    await expect(page.locator('.stallplan-badge.fail')).toHaveCount(1);
    await expect(page.locator('.stallplan-compartment.non-compliant')).toHaveCount(1);
  });

  test('Mehrere Kategorien in einem Abteil werden für die Flächenprüfung addiert', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }]);
      // 4x5 = 20 m²
      window.__ffTestStallplaner.addCompartment([{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 6 }, { x: 1, y: 6 }]);
    });
    await page.locator('#stallplaner-tierart-select').selectOption('rinder');
    // 2 Kälber (1.5 m²/Tier = 3 m²) + 3 Milchkühe (6 m²/Tier = 18 m²) = 21 m² > 20 m² -> nicht konform
    await page.locator('.stallplan-tb-add').click();
    await page.locator('.stallplan-tb-kategorie').first().selectOption('rind_kalb');
    await page.locator('.stallplan-tb-anzahl').first().fill('2');
    await page.locator('.stallplan-tb-anzahl').first().dispatchEvent('change');
    await page.locator('.stallplan-tb-add').click();
    await page.locator('.stallplan-tb-kategorie').nth(1).selectOption('rind_milchkuh');
    await page.locator('.stallplan-tb-anzahl').nth(1).fill('3');
    await page.locator('.stallplan-tb-anzahl').nth(1).dispatchEvent('change');
    await expect(page.locator('.stallplan-tb-row')).toHaveCount(2);
    await expect(page.locator('.stallplan-badge.fail')).toContainText('1.0 m²');

    // Eine der beiden Kategorien wieder entfernen -> nur noch 18 m² nötig, wieder konform
    await page.locator('.stallplan-tb-remove').first().click();
    await expect(page.locator('.stallplan-tb-row')).toHaveCount(1);
    await expect(page.locator('.stallplan-badge.ok')).toHaveCount(1);
  });

  test('Kantenlänge lässt sich zentimetergenau eingeben', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
    });
    await page.locator('button[data-tool="edit-vertex"]').click();
    await page.locator('.stallplan-outline').click();
    await expect(page.locator('.stallplan-edge-label').first()).toHaveText('4.00 m');
    // Klickziel ist das unsichtbare Hit-Rechteck, nicht der Text direkt —
    // siehe appendEdgeLengthLabels() in main.js.
    await page.locator('.stallplan-edge-label-hit').first().click();
    const input = page.locator('#stallplan-edge-length-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('4.00');
    await input.fill('5.25');
    await input.press('Enter');
    await expect(input).toBeHidden();
    const plan = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
    // Erster Punkt (0,0) bleibt fest, zweiter wandert auf x=5.25 (Kante war horizontal).
    expect(plan.outline.points[0]).toEqual({ x: 0, y: 0 });
    expect(plan.outline.points[1].x).toBeCloseTo(5.25, 2);
    expect(plan.outline.points[1].y).toBeCloseTo(0, 2);
  });

  test('Rückgängig/Wiederherstellen wirkt auf den Umriss', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]);
    });
    await expect(page.locator('.stallplan-outline')).toHaveCount(1);
    await expect(page.locator('#stallplaner-undo')).toBeEnabled();
    await page.locator('#stallplaner-undo').click();
    await expect(page.locator('.stallplan-outline')).toHaveCount(0);
    await expect(page.locator('#stallplaner-redo')).toBeEnabled();
    await page.locator('#stallplaner-redo').click();
    await expect(page.locator('.stallplan-outline')).toHaveCount(1);
  });

  test('serializeWorkspace/restoreWorkspace-Rundlauf erhält Umriss, Abteile und Ausstattung', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]);
      window.__ffTestStallplaner.addCompartment(
        [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }],
        { name: 'Kälberbox', tierbestand: [{ id: 'tb-test', kategorieId: 'rind_kalb', tieranzahl: 2, avgGewichtKg: null }] }
      );
      window.__ffTestStallplaner.addEquipment('traenke', 2, 2);
    });
    const restored = await page.evaluate(() => {
      const serialized = window.__ffTestStallplaner.serializeStallplaene();
      window.__ffTestStallplaner.restoreStallplaene(serialized);
      return window.__ffTestStallplaner.getActivePlan();
    });
    expect(restored.outline.points).toHaveLength(4);
    expect(restored.compartments).toHaveLength(1);
    expect(restored.compartments[0].name).toBe('Kälberbox');
    expect(restored.compartments[0].tierbestand).toHaveLength(1);
    expect(restored.compartments[0].tierbestand[0]).toMatchObject({ kategorieId: 'rind_kalb', tieranzahl: 2 });
    expect(restored.equipment).toHaveLength(1);
    expect(restored.equipment[0]).toMatchObject({ type: 'traenke', geometryKind: 'point', points: [{ x: 2, y: 2 }] });
  });

  test('Datei-Export/-Import (.json) erhält den Stallplan', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]);
    });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#btn-stallplaner-export-json').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    const path = await download.path();
    expect(path).toBeTruthy();

    // Neuen, leeren Plan anlegen, dann die exportierte Datei wieder laden —
    // muss als zusätzlicher, dritter Plan mit demselben Umriss erscheinen.
    await page.locator('#stallplaner-new-plan').click();
    await page.setInputFiles('#stallplaner-import-input', path);
    await expect(page.locator('#stallplaner-status')).toContainText('geladen');
    const plan = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
    expect(plan.outline.points).toHaveLength(4);
  });

  test('PDF-Export liefert eine Datei mit Plan- und Abteilseite', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]);
      window.__ffTestStallplaner.addCompartment([{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }]);
    });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('#btn-export-stallplaner-pdf').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    const path = await download.path();
    expect(path).toBeTruthy();
  });

  test('Zoomen per Mausrad verengt den sichtbaren Ausschnitt', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]);
    });
    const before = await page.evaluate(() => document.getElementById('stallplan-svg').getAttribute('viewBox'));
    const svgBox = await page.locator('#stallplan-svg').boundingBox();
    await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2);
    await page.mouse.wheel(0, -300); // hineinzoomen
    const after = await page.evaluate(() => document.getElementById('stallplan-svg').getAttribute('viewBox'));
    expect(after).not.toBe(before);
    const beforeW = parseFloat(before.split(' ')[2]);
    const afterW = parseFloat(after.split(' ')[2]);
    expect(afterW).toBeLessThan(beforeW);
  });

  test('Ziehen ohne aktives Werkzeug verschiebt die Ansicht, mit aktivem Werkzeug nicht', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]);
    });
    const svgBox = await page.locator('#stallplan-svg').boundingBox();
    const before = await page.evaluate(() => document.getElementById('stallplan-svg').getAttribute('viewBox'));
    await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(svgBox.x + svgBox.width / 2 + 80, svgBox.y + svgBox.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    const afterDrag = await page.evaluate(() => document.getElementById('stallplan-svg').getAttribute('viewBox'));
    expect(afterDrag).not.toBe(before);

    // Mit aktivem Zeichenwerkzeug dient derselbe Drag dem Punkte-Setzen,
    // nicht dem Verschieben der Ansicht (Umriss existiert schon, daher
    // ein Abteil skizzieren).
    await gotoStep(page, 'abteile');
    await page.locator('#stallplaner-actions [data-act="add-compartment"]').click();
    await page.locator('#stallplaner-tool-compartment').click();
    const beforeTool = await page.evaluate(() => document.getElementById('stallplan-svg').getAttribute('viewBox'));
    await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(svgBox.x + svgBox.width / 2 + 80, svgBox.y + svgBox.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    const afterTool = await page.evaluate(() => document.getElementById('stallplan-svg').getAttribute('viewBox'));
    expect(afterTool).toBe(beforeTool);
  });

  test('Abteil-Auswahl im Bearbeiten-Modus fokussiert die Ansicht darauf, "Ansicht anpassen" setzt zurück', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 15 }, { x: 0, y: 15 }]);
      window.__ffTestStallplaner.addCompartment([{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }]);
    });
    await page.locator('button[data-tool="edit-vertex"]').click();
    await page.locator('.stallplan-compartment polygon').click();
    const focused = await page.evaluate(() => document.getElementById('stallplan-svg').getAttribute('viewBox'));
    const focusedW = parseFloat(focused.split(' ')[2]);
    expect(focusedW).toBeLessThan(10); // deutlich enger als der 20x15-Umriss

    await page.locator('#stallplaner-fit-view').click();
    const fitted = await page.evaluate(() => document.getElementById('stallplan-svg').getAttribute('viewBox'));
    const fittedW = parseFloat(fitted.split(' ')[2]);
    expect(fittedW).toBeGreaterThan(15); // wieder auf den ganzen Umriss gezoomt
  });

  test('Rechtwinklige Rekonstruktion: aus einer schiefen Skizze + exakten Maßen entsteht ein sauberes Rechteck', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Absichtlich schiefe/ungenaue Skizze (kein Punkt exakt rechtwinklig
      // oder achsenparallel) — die Vermessung soll trotzdem ein exaktes
      // 6x4-Rechteck (24 m²) liefern, weil nur der Drehsinn der Ecken aus
      // der Skizze übernommen wird, nicht ihre ungefähren Winkel/Maße.
      const sketch = [{ x: 0, y: 0 }, { x: 5.7, y: 0.6 }, { x: 6.1, y: 4.3 }, { x: -0.4, y: 3.6 }];
      return window.__ffTestStallplaner.reconstructRectilinear(sketch, [6, 4, 6, 4]);
    });
    expect(result.misclosure).toBeCloseTo(0, 5);
    const [p0, p1, p2, p3] = result.points;
    const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    expect(len(p0, p1)).toBeCloseTo(6, 5);
    expect(len(p1, p2)).toBeCloseTo(4, 5);
    expect(len(p2, p3)).toBeCloseTo(6, 5);
    expect(len(p3, p0)).toBeCloseTo(4, 5);
    // Shoelace-Fläche muss exakt 24 m² ergeben (6x4), nicht die verzerrte
    // Fläche der Ausgangsskizze.
    const shoelace = Math.abs(result.points.reduce((s, p, i) => {
      const n = result.points[(i + 1) % 4];
      return s + (p.x * n.y - n.x * p.y);
    }, 0)) / 2;
    expect(shoelace).toBeCloseTo(24, 4);
  });

  test('Rechtwinklige Rekonstruktion gleicht kleine Messungenauigkeiten aus (Schlussfehler-Ausgleich)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const sketch = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 0, y: 3 }];
      // Leicht inkonsistente reale Messwerte (5,3,5,3 wäre exakt geschlossen).
      return window.__ffTestStallplaner.reconstructRectilinear(sketch, [5.01, 3.0, 4.98, 3.02]);
    });
    expect(result.misclosure).toBeGreaterThan(0);
    expect(result.misclosure).toBeLessThan(0.1);
    // Trotz Ausgleich bleibt der erste Punkt als Anker exakt fest.
    expect(result.points[0]).toEqual({ x: 0, y: 0 });
  });

  // Trapez wie im Nutzer-Screenshot: Wände 5 · 9 · 5,39 · 11, links zwei
  // rechte Winkel, rechts eine schräge Wand (Ecken ~68°/112°).
  const TRAPEZ = [{ x: 0, y: 5 }, { x: 0, y: 0 }, { x: 9, y: 0 }, { x: 11, y: 5 }];
  const shoelaceOf = (pts) => Math.abs(pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return s + (p.x * q.y - q.x * p.y);
  }, 0)) / 2;

  test('Vermessen einer Skizze mit schräger Wand: Skizzenmaße übernehmen lässt die Form unverändert', async ({ page }) => {
    const result = await page.evaluate((pts) => window.__ffTestStallplaner.reconstructRectilinear(pts, [5, 9, Math.sqrt(29), 11]), TRAPEZ);
    expect(result.misclosure).toBeLessThan(1e-6);
    expect(result.freeCorners).toBe(2);
    result.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(TRAPEZ[i].x, 5);
      expect(p.y).toBeCloseTo(TRAPEZ[i].y, 5);
    });
  });

  test('Vermessen einer Skizze mit schräger Wand: neue Maße behalten die rechten Winkel, schräge Wand passt sich an', async ({ page }) => {
    // Oben 10 statt 9 gemessen, schräge Wand dazu passend sqrt(1² + 5²).
    const result = await page.evaluate((pts) => window.__ffTestStallplaner.reconstructRectilinear(pts, [5, 10, Math.sqrt(26), 11]), TRAPEZ);
    expect(result.misclosure).toBeLessThan(1e-6);
    const [a, b, c, d] = result.points;
    // Linke Wand senkrecht, obere und untere Wand waagerecht (rechte Winkel).
    expect(b.x - a.x).toBeCloseTo(0, 5);
    expect(c.y - b.y).toBeCloseTo(0, 5);
    expect(a.y - d.y).toBeCloseTo(0, 5);
    expect(c.x - b.x).toBeCloseTo(10, 5);
    expect(shoelaceOf(result.points)).toBeCloseTo((10 + 11) / 2 * 5, 4); // 52,5 m²
  });

  test('Vermessen-Modus mit schräger Wand: alles überspringen verändert die Form nicht', async ({ page }) => {
    await page.evaluate((pts) => window.__ffTestStallplaner.setOutline(pts), TRAPEZ);
    await page.locator('button[data-tool="measure"]').click();
    await page.locator('.stallplan-outline').click();
    for (let i = 0; i < 4; i++) await page.locator('#stallplaner-measure-skip').click();
    await expect(page.locator('#stallplaner-measure-panel')).toBeHidden();
    const plan = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
    plan.outline.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(TRAPEZ[i].x, 4);
      expect(p.y).toBeCloseTo(TRAPEZ[i].y, 4);
    });
    await expect(page.locator('#stallplaner-status')).toContainText('2 schräge Ecken');
  });

  test('Geführter Vermessen-Modus: Kante für Kante durchgehen ergibt die korrekte Fläche', async ({ page }) => {
    await page.locator('button[data-tool="draw-outline"]').click();
    await clickSvgPoints(page, [[0.25, 0.25], [0.62, 0.28], [0.65, 0.55], [0.22, 0.52]]);
    await finishDrawWithDblClick(page, 0.22, 0.52);

    await page.locator('button[data-tool="measure"]').click();
    await page.locator('.stallplan-outline').click();
    await expect(page.locator('#stallplaner-measure-panel')).toBeVisible();
    await expect(page.locator('#stallplaner-measure-progress')).toHaveText('Kante 1 von 4');

    for (const len of ['8', '5', '8', '5']) {
      await page.locator('#stallplaner-measure-input').fill(len);
      await page.locator('#stallplaner-measure-next').click();
    }
    await expect(page.locator('#stallplaner-measure-panel')).toBeHidden();
    await expect(page.locator('#stallplaner-status')).toContainText('Vermessen abgeschlossen');
    await expect(page.locator('#stallplaner-total-area')).toContainText('40.0 m²');
    const plan = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
    const [p0, p1] = plan.outline.points;
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y) * plan.gridScale).toBeCloseTo(8, 1);
  });

  test('Geführter Vermessen-Modus: Zurück und Überspringen funktionieren', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 0, y: 3 }]);
    });
    await page.locator('button[data-tool="measure"]').click();
    await page.locator('.stallplan-outline').click();

    await page.locator('#stallplaner-measure-input').fill('5.2');
    await page.locator('#stallplaner-measure-next').click();
    await expect(page.locator('#stallplaner-measure-progress')).toHaveText('Kante 2 von 4');

    // Zurück zur ersten Kante, der vorher eingegebene Wert wird wieder angezeigt.
    await page.locator('#stallplaner-measure-back').click();
    await expect(page.locator('#stallplaner-measure-progress')).toHaveText('Kante 1 von 4');
    await expect(page.locator('#stallplaner-measure-input')).toHaveValue('5.2');

    await page.locator('#stallplaner-measure-next').click(); // wieder auf Kante 2
    await page.locator('#stallplaner-measure-skip').click(); // Skizzenlänge übernehmen
    await page.locator('#stallplaner-measure-skip').click();
    await page.locator('#stallplaner-measure-skip').click();
    await expect(page.locator('#stallplaner-measure-panel')).toBeHidden();
    const plan = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
    expect(plan.outline.points).toHaveLength(4);
  });

  test('Geführter Vermessen-Modus: Abbrechen lässt die Skizze unverändert', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }, { x: 0, y: 3 }]);
    });
    const before = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().outline.points);
    await page.locator('button[data-tool="measure"]').click();
    await page.locator('.stallplan-outline').click();
    await page.locator('#stallplaner-measure-input').fill('9.99');
    await page.locator('#stallplaner-measure-next').click();
    await page.locator('#stallplaner-measure-cancel').click();
    await expect(page.locator('#stallplaner-measure-panel')).toBeHidden();
    const after = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().outline.points);
    expect(after).toEqual(before);
  });

  test('Ausstattungstyp mit Linien-Vorgabe (Sitzstange) wählt automatisch "Linie", zweipunktige Linie lässt sich zeichnen', async ({ page }) => {
    await gotoStep(page, 'ausstattung');
    await page.locator('button[data-tool="place-equipment"]').click();
    await page.locator('button[data-equip="sitzstange"]').click();
    await expect(page.locator('#stallplaner-equip-geometry-toggle [data-geometry="line"]')).toHaveClass(/active/);

    await clickSvgPoints(page, [[0.3, 0.3], [0.6, 0.3]]);
    await finishDrawWithDblClick(page, 0.6, 0.3);

    const equipment = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().equipment);
    expect(equipment).toHaveLength(1);
    expect(equipment[0]).toMatchObject({ type: 'sitzstange', geometryKind: 'line' });
    expect(equipment[0].points).toHaveLength(2);
    // Werkzeug bleibt scharf, um gleich die nächste Sitzstange zu zeichnen.
    await expect(page.locator('button[data-tool="place-equipment"]')).toHaveClass(/active/);
  });

  test('Ausstattungstyp mit Flächen-Vorgabe (Futtergang) wählt automatisch "Fläche", schließt sich per Klick am Start', async ({ page }) => {
    await gotoStep(page, 'ausstattung');
    await page.locator('button[data-tool="place-equipment"]').click();
    await page.locator('button[data-equip="futtergang"]').click();
    await expect(page.locator('#stallplaner-equip-geometry-toggle [data-geometry="area"]')).toHaveClass(/active/);

    await clickSvgPoints(page, [[0.3, 0.3], [0.5, 0.3], [0.5, 0.45]]);
    const startDot = page.locator('.stallplan-draw-point').first();
    const box = await startDot.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const equipment = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().equipment);
    expect(equipment).toHaveLength(1);
    expect(equipment[0]).toMatchObject({ type: 'futtergang', geometryKind: 'area' });
    expect(equipment[0].points).toHaveLength(3);
  });

  test('Manuelles Umschalten auf "Punkt" setzt einen Punkt trotz Typ mit Linien-Vorgabe', async ({ page }) => {
    await gotoStep(page, 'ausstattung');
    await page.locator('button[data-tool="place-equipment"]').click();
    await page.locator('button[data-equip="sitzstange"]').click();
    await page.locator('#stallplaner-equip-geometry-toggle [data-geometry="point"]').click();
    await clickSvgPoints(page, [[0.4, 0.4]]);
    const equipment = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().equipment);
    expect(equipment).toHaveLength(1);
    expect(equipment[0]).toMatchObject({ type: 'sitzstange', geometryKind: 'point' });
    expect(equipment[0].points).toHaveLength(1);
  });

  test('Linien-/Flächen-Ausstattung: Eckpunkt-Auswahl im Bearbeiten-Modus zeigt Kantenlängen, Löschen entfernt sie', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.addEquipmentShape('futtergang', 'area',
        [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }]);
    });
    await page.locator('button[data-tool="edit-vertex"]').click();
    await clickSelector(page, '.stallplan-equipment-shape');
    await expect(page.locator('.stallplan-edge-label').first()).toHaveText('4.00 m');
    await expect(page.locator('.stallplan-vertex-handle')).toHaveCount(4);

    await page.locator('button[data-tool="delete"]').click();
    await clickSelector(page, '.stallplan-equipment-shape');
    const equipment = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().equipment);
    expect(equipment).toHaveLength(0);
  });

  test('Linien-Ausstattung verschieben (Ganz-Element-Drag) bewegt alle Punkte um denselben Versatz', async ({ page }) => {
    await page.evaluate(() => {
      window.__ffTestStallplaner.addEquipmentShape('sitzstange', 'line', [{ x: 2, y: 2 }, { x: 5, y: 2 }]);
    });
    await page.locator('button[data-tool="edit-vertex"]').click();
    const shape = page.locator('.stallplan-equipment-shape');
    const box = await shape.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    const equipment = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().equipment[0]);
    // Beide Punkte müssen um denselben Versatz verschoben worden sein (Länge unverändert).
    const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    expect(len(equipment.points[0], equipment.points[1])).toBeCloseTo(3, 1);
    expect(equipment.points[0]).not.toEqual({ x: 2, y: 2 });
  });
});
