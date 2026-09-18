// Gemeinsame Helfer für die Playwright-Regressionstests. Zeichnen über
// Leaflet.draw lässt sich nicht zuverlässig per simuliertem Maus-Event
// auslösen (siehe AGENTS.md) — stattdessen wird der jeweilige Draw-Handler
// über die Werkzeugleiste scharf gestellt und danach direkt ein
// 'draw:created'-Event auf der (nur im Dev-Server über window.__ffTestMap
// verfügbaren) Karteninstanz gefeuert.

export async function gotoTab(page, label) {
  await page.locator('.segment-btn', { hasText: label }).click();
}

export async function drawZeichnerPolygon(page, latlngs) {
  await page.locator('#shape-tool-draw').click();
  await page.evaluate((coords) => {
    const map = window.__ffTestMap;
    const layer = window.L.polygon(coords);
    map.fire('draw:created', { layer, layerType: 'polygon' });
  }, latlngs);
}

export async function drawHofplanRect(page, latlngs) {
  await page.locator('#hofplan-tool-rect').click();
  await page.evaluate((coords) => {
    const map = window.__ffTestMap;
    const layer = window.L.rectangle(coords);
    map.fire('draw:created', { layer, layerType: 'rectangle' });
  }, latlngs);
}

export async function drawHofplanPolygon(page, latlngs) {
  await page.locator('#hofplan-tool-poly').click();
  await page.evaluate((coords) => {
    const map = window.__ffTestMap;
    const layer = window.L.polygon(coords);
    map.fire('draw:created', { layer, layerType: 'polygon' });
  }, latlngs);
}

// Ein Rechteck ist immer eindeutig als Bounding-Box beschreibbar — kleine,
// beieinanderliegende Testkoordinaten reichen für die Regressionstests,
// die reale Position ist irrelevant.
export const TEST_RECT_A = [[51.10, 10.40], [51.1006, 10.4012]];
export const TEST_RECT_B = [[51.20, 10.50], [51.2006, 10.5012]];
export const TEST_POLY_A = [[51.10, 10.40], [51.10, 10.42], [51.12, 10.42], [51.12, 10.40]];
