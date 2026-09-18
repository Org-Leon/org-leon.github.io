import { test, expect } from '@playwright/test';
import { gotoTab } from './helpers.js';

// Regressionstest für den "width:100% + horizontale margin"-Bug (Sidebar
// wurde dadurch horizontal scrollbar, siehe git-Historie) — prüft auf allen
// Tabs, da jeder eigene Sidebar-Inhalte einblendet.
const TABS = ['Jahresvergleich', 'Flächenzeichner', 'Obstbaumkataster', 'Bienenflugkarte', 'Hofplan'];

test.describe('Sidebar-Layout', () => {
  test('Sidebar ist auf keinem Tab horizontal scrollbar', async ({ page }) => {
    await page.goto('/');
    for (const tab of TABS) {
      await gotoTab(page, tab);
      const overflow = await page.evaluate(() => {
        const sidebar = document.getElementById('sidebar');
        return sidebar.scrollWidth - sidebar.clientWidth;
      });
      expect(overflow, `Sidebar-Überlauf auf Tab "${tab}"`).toBeLessThanOrEqual(1);
    }
  });

  test('Sidebar ist auch bei schmaler Ansicht (Mobile) nicht horizontal scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    for (const tab of TABS) {
      // Auf schmalen Bildschirmen liegt die Sidebar als Einschub vor (Klasse
      // "sidebar-open" an <body>), den setActiveSegment() bei jeder Tab-
      // Auswahl automatisch wieder schließt (closeMobileSidebar()) — die
      // Klasse direkt setzen statt über den Umschalt-Button zu klicken, da
      // ein Toggle-Klick je nach vorherigem Zustand mal öffnet, mal schließt.
      await page.evaluate(() => document.body.classList.add('sidebar-open'));
      await gotoTab(page, tab);
      await page.evaluate(() => document.body.classList.add('sidebar-open'));
      const overflow = await page.evaluate(() => {
        const sidebar = document.getElementById('sidebar');
        return sidebar.scrollWidth - sidebar.clientWidth;
      });
      expect(overflow, `Sidebar-Überlauf (mobil) auf Tab "${tab}"`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('Terminkalender-Umschalter', () => {
  test('ist ohne Anmeldung in der normalen Ansicht ausgeblendet', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#terminkalender-switcher')).toBeHidden();
  });
});

test.describe('Werkzeugleisten-Sichtbarkeit', () => {
  test('#edit-toolbar nur im Flächenzeichner-/Hofplan-Tab sichtbar, mit passender Gruppe', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#edit-toolbar')).toBeHidden();

    await gotoTab(page, 'Flächenzeichner');
    await expect(page.locator('#edit-toolbar')).toBeVisible();
    await expect(page.locator('.edit-toolbar-group[data-view="zeichner"]')).toBeVisible();
    await expect(page.locator('.edit-toolbar-group[data-view="hofplan"]')).toBeHidden();

    await gotoTab(page, 'Hofplan');
    await expect(page.locator('#edit-toolbar')).toBeVisible();
    await expect(page.locator('.edit-toolbar-group[data-view="hofplan"]')).toBeVisible();
    await expect(page.locator('.edit-toolbar-group[data-view="zeichner"]')).toBeHidden();

    await gotoTab(page, 'Obstbaumkataster');
    await expect(page.locator('#edit-toolbar')).toBeHidden();
  });

  test('Werkzeugleiste lässt sich per Drag am Griff verschieben', async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Flächenzeichner');
    const toolbar = page.locator('#edit-toolbar');
    const before = await toolbar.boundingBox();
    const handle = page.locator('#edit-toolbar-handle');
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 220, handleBox.y + 180, { steps: 10 });
    await page.mouse.up();
    const after = await toolbar.boundingBox();
    expect(after.x).not.toBeCloseTo(before.x, 0);
  });

  test('An den oberen Kartenrand gezogen wird die Leiste horizontal', async ({ page }) => {
    await page.goto('/');
    await gotoTab(page, 'Flächenzeichner');
    const toolbar = page.locator('#edit-toolbar');
    const handle = page.locator('#edit-toolbar-handle');
    const handleBox = await handle.boundingBox();
    const mapBox = await page.locator('#map-wrap').boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 40, mapBox.y + 5, { steps: 10 });
    await page.mouse.up();
    await expect(toolbar).toHaveClass(/horizontal/);
  });
});
