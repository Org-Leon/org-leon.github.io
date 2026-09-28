import { test, expect } from '@playwright/test';
import { gotoTab } from './helpers.js';

// Regressionstest für den "width:100% + horizontale margin"-Bug (Sidebar
// wurde dadurch horizontal scrollbar, siehe git-Historie) — prüft auf allen
// Tabs, da jeder eigene Sidebar-Inhalte einblendet.
const TABS = ['Jahresvergleich', 'Flächenzeichner', 'Obstbaumkataster', 'Bienenflugkarte', 'Hofplan', 'Stallplaner'];

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

test.describe('Kopfzeile', () => {
  test('Cloud-Sync-Schalter erscheint nur mit Anmeldung', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-account')).toBeVisible();
    await expect(page.locator('#btn-sync')).toBeHidden();

    await page.evaluate(() => window.__ffTestTk.loginFake());
    await expect(page.locator('#btn-sync')).toBeVisible();

    // Abmelden (derselbe Weg wie der Abmelden-Button: Session weg + Kopfzeile neu).
    await page.evaluate(() => window.__ffTestTk.logoutFake());
    await expect(page.locator('#btn-sync')).toBeHidden();
  });
});

// Einheitliches Schema der Seitenleiste (index.html/style.css "Seitenleiste:
// einheitliches Werkzeug-Schema"): Werkzeug oben mit kurzem Hinweis,
// Ebenen in der Mitte, Exporte unten — in jeder Funktion ohne Anmeldung.
test.describe('Seitenleiste: einheitliches Schema', () => {
  const MAP_TOOLS = ['zeichner', 'obstbaum', 'bienenflug', 'hofplan'];

  test('Karten-Werkzeuge: Hinweis oben, Ebenen darunter, Exporte unten, kein "Bereit."', async ({ page }) => {
    await page.goto('/');
    for (const view of MAP_TOOLS) {
      await page.locator(`.segment-btn[data-view="${view}"]`).click();
      const section = page.locator(`.sidebar-section[data-view="${view}"]`);
      const hint = section.locator('.tool-hint').first();
      const footer = section.locator('.tool-footer').first();
      await expect(hint).toBeVisible();
      await expect(footer.locator('.tool-btn.primary')).toBeVisible();
      const [hintY, layersY, footerY] = await Promise.all([
        hint.evaluate(el => el.getBoundingClientRect().top),
        page.locator('#layer-section').evaluate(el => el.getBoundingClientRect().top),
        footer.evaluate(el => el.getBoundingClientRect().top)
      ]);
      expect(hintY, view).toBeLessThan(layersY);
      expect(layersY, view).toBeLessThan(footerY);
      // Kurzhinweis bleibt kurz (eine, höchstens zwei Zeilen).
      expect((await hint.textContent()).trim().length, view).toBeLessThan(80);
      await expect(page.locator('#sidebar')).not.toContainText('Bereit.');
    }
  });

  test('"Karte" hat einen eigenen Button und ist die Startansicht', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.segment-btn[data-view="viewer"]')).toHaveClass(/active/);
    await page.locator('.segment-btn[data-view="hofplan"]').click();
    await page.locator('.segment-btn[data-view="viewer"]').click();
    await expect(page.locator('.segment-btn[data-view="viewer"]')).toHaveClass(/active/);
    await expect(page.locator('#btn-export-flaechenkarten')).toBeVisible();
  });

  test('Stallplaner ohne Plan zeigt weder Einstellungen noch Export/Löschen', async ({ page }) => {
    await page.goto('/');
    await page.locator('.segment-btn[data-view="stallplaner"]').click();
    await expect(page.locator('#stallplaner-new-plan')).toBeVisible();
    await expect(page.locator('#stallplaner-settings')).toBeHidden();
    await expect(page.locator('#btn-stallplaner-delete-plan')).toBeHidden();
    await expect(page.locator('#btn-export-stallplaner-pdf')).toBeHidden();
    // Laden eines gespeicherten Plans geht auch ohne vorhandenen Plan.
    await expect(page.locator('#stallplaner-import-drop')).toBeVisible();
  });
});
