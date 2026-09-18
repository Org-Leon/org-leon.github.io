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

test.describe('Werkzeugleisten-Sichtbarkeit', () => {
  test('Flächenzeichner-Werkzeugleiste nur im Flächenzeichner-Tab sichtbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#shape-toolbar')).toBeHidden();
    await gotoTab(page, 'Flächenzeichner');
    await expect(page.locator('#shape-toolbar')).toBeVisible();
    await gotoTab(page, 'Hofplan');
    await expect(page.locator('#shape-toolbar')).toBeHidden();
  });

  test('Hofplan-Werkzeugleiste nur im Hofplan-Tab sichtbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hofplan-toolbar')).toBeHidden();
    await gotoTab(page, 'Hofplan');
    await expect(page.locator('#hofplan-toolbar')).toBeVisible();
    await gotoTab(page, 'Obstbaumkataster');
    await expect(page.locator('#hofplan-toolbar')).toBeHidden();
  });
});
