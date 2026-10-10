import { test, expect } from '@playwright/test';

// Obstbaumkataster: Obstart wählen und Bäume setzen, Stand in der Seitenleiste
// (Zähler je Obstart, Summe, "ohne Fläche"), "Sonstige Obstart" klappt in der
// Seitenleiste auf, Baumtabelle mit Filter, markierter Baum auf der Karte,
// Entfernen ohne Rechtsklick. In beiden Designs. Alle Daten frei erfunden.
const FLAECHEN = { type: 'FeatureCollection', features: [['1', 'Streuobstwiese', 0], ['2', 'Hausgarten', 1]].map(([nr, name, i]) => {
  const x = 11.80 + i * 0.004, y = 48.40;
  return { type: 'Feature', properties: { SCHLAG_NR: nr, NAME: name, NUTZ_BEZ: 'Streuobst', FLAECHE: '1.20' },
    geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.003, y], [x + 0.003, y + 0.002], [x, y + 0.002], [x, y]]] } };
}) };
const IN_1 = [[48.4015, 11.8008], [48.4010, 11.8015]];   // in Fläche 1
const IN_2 = [48.4010, 11.8055];                          // in Fläche 2
const DRAUSSEN = [48.4035, 11.8015];                      // in keiner Fläche

// Auf eine Koordinate der Karte klicken (Position über die Karten-Instanz bestimmt)
async function karteKlick(page, [lat, lng]) {
  const p = await page.evaluate(([la, ln]) => {
    const pt = window.__ffTestMap.latLngToContainerPoint([la, ln]);
    const r = window.__ffTestMap.getContainer().getBoundingClientRect();
    return { x: r.left + pt.x, y: r.top + pt.y };
  }, [lat, lng]);
  await page.mouse.click(p.x, p.y);
}

for (const design of ['standard', 'feldbuch']) {
  test(`Obstbaumkataster (${design}): setzen, Stand, Sonstige Obstart, Tabelle mit Filter, entfernen`, async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.goto('/?design=' + design);
    await page.setInputFiles('#file-input', { name: 'Obstflaechen.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(FLAECHEN)) });
    await page.locator('.segment-btn[data-view="obstbaum"]').click();
    const zahlen = page.locator('#obstbaum-zahlen');
    const aktiv = page.locator('#obstbaum-aktiv');
    const undo = page.locator('#btn-obstbaum-undo');
    await expect(zahlen).toHaveText('Noch keine Bäume erfasst.');
    await expect(undo).toBeDisabled();
    await expect(aktiv).toBeHidden();

    // Obstart-Knöpfe: alle gleich hoch (auch der zweizeilige), Punkt rund wie auf der Karte
    const hoehen = await page.locator('.fruit-btn').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));
    expect(hoehen).toHaveLength(6);
    expect(new Set(hoehen).size).toBe(1);
    expect(await page.locator('.fruit-btn .fruit-dot').first().evaluate(el => getComputedStyle(el).borderTopLeftRadius)).not.toBe('0px');

    // Apfel wählen: steht unter der Auswahl; drei Bäume setzen (zwei in Fläche 1, einer außerhalb)
    await page.locator('.fruit-btn[data-key="apfel"]').click();
    await expect(aktiv).toBeVisible();
    await expect(page.locator('#obstbaum-aktiv-text')).toHaveText('Apfel — auf die Karte tippen');
    for (const ort of [...IN_1, DRAUSSEN]) await karteKlick(page, ort);
    await expect(page.locator('.fruit-btn[data-key="apfel"] .fruit-count')).toHaveText('3');
    await expect(zahlen).toHaveText('3 Bäume · 1 Obstart · 1 ohne Fläche');
    await expect(undo).toBeEnabled();
    // Birne in Fläche 2
    await page.locator('.fruit-btn[data-key="birne"]').click();
    await karteKlick(page, IN_2);
    await expect(page.locator('.fruit-btn[data-key="birne"] .fruit-count')).toHaveText('1');
    await expect(page.locator('.fruit-btn[data-key="walnuss"] .fruit-count')).toBeHidden();

    // "Sonstige Obstart": klappt in der Seitenleiste auf (verdeckt nichts) und bleibt beim Setzen offen
    const liste = page.locator('#obstbaum-sonstige-list');
    await page.locator('#obstbaum-sonstige-toggle').click();
    await expect(liste).toBeVisible();
    await expect(page.locator('#obstbaum-sonstige-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(await liste.evaluate(el => getComputedStyle(el).position)).toBe('static');
    const [listeBox, zahlenBox] = [await liste.boundingBox(), await page.locator('.obst-uebersicht').boundingBox()];
    expect(zahlenBox.y).toBeGreaterThanOrEqual(listeBox.y + listeBox.height);
    await liste.locator('.fruit-list-row[data-key="mirabelle"]').click();
    await expect(page.locator('#obstbaum-aktiv-text')).toHaveText('Mirabelle — auf die Karte tippen');
    await karteKlick(page, [48.4005, 11.8010]);
    await expect(liste).toBeVisible();
    await expect(liste.locator('.fruit-list-row[data-key="mirabelle"] .fruit-count')).toHaveText('1');
    await expect(zahlen).toHaveText('5 Bäume · 3 Obstarten · 1 ohne Fläche');
    // "Fertig" beendet das Setzen
    await page.locator('#obstbaum-aktiv-fertig').click();
    await expect(aktiv).toBeHidden();
    await expect(page.locator('.fruit-btn.active, .fruit-list-row.active')).toHaveCount(0);
    await page.locator('#obstbaum-sonstige-toggle').click();
    await expect(liste).toBeHidden();
    // Seitenleiste läuft nicht seitlich über
    expect(await page.locator('#sidebar').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    // Baumtabelle: vier Spalten, Fläche mit Nummer und Name, Aktionen rechts
    await page.locator('#btn-obstbaum-table').click();
    const zeilen = page.locator('#obstbaum-table-body tr[data-id]');
    await expect(zeilen).toHaveCount(5);
    await expect(page.locator('#obstbaum-table thead th')).toHaveCount(4);
    await expect(zeilen.nth(0).locator('td').nth(2)).toHaveText('1 · Streuobstwiese');
    await expect(zeilen.nth(2).locator('td').nth(2)).toHaveText('ohne Fläche');
    await expect(zeilen.nth(3).locator('td').nth(2)).toHaveText('2 · Hausgarten');
    await expect(zeilen.nth(0).locator('[data-action="remove"]')).toHaveAttribute('aria-label', 'Baum Nr. 1 entfernen');
    // Filter: Obstart-Knöpfe über der Tabelle
    const filter = page.locator('#obstbaum-summary-row [data-obst-filter]');
    await expect(filter).toHaveText(['Alle 5', 'Apfel 3', 'Birne 1', 'Mirabelle 1', 'ohne Fläche 1']);
    await filter.filter({ hasText: 'Apfel' }).click();
    await expect(zeilen).toHaveCount(3);
    await expect(page.locator('#obstbaum-table-count')).toHaveText('3 von 5');
    await expect(filter.filter({ hasText: 'Apfel' })).toHaveAttribute('aria-pressed', 'true');
    await filter.filter({ hasText: 'ohne Fläche' }).click();
    await expect(zeilen).toHaveCount(1);
    await expect(zeilen.first().locator('.obst-nr')).toHaveText('3');
    await filter.filter({ hasText: 'Birne' }).click();
    await expect(zeilen).toHaveCount(1);

    // Zeile antippen markiert den Baum auch auf der Karte
    await zeilen.first().locator('.obst-nr').click();
    await expect(zeilen.first()).toHaveClass(/row-selected/);
    await expect(page.locator('#map .tree-marker-icon.is-selected')).toHaveCount(1);
    // Baum auf der Karte antippen, den der Filter ausblendet: Filter geht auf, Zeile ist markiert
    await page.locator('#map .tree-marker-icon').first().dispatchEvent('click');
    await expect(zeilen).toHaveCount(5);
    await expect(page.locator('#obstbaum-table-count')).toHaveText('5');
    await expect(zeilen.nth(0)).toHaveClass(/row-selected/);
    await expect(page.locator('#map .tree-marker-icon.is-selected')).toHaveCount(1);

    // Entfernen: in der Tabelle und mit "Letzten Baum entfernen" (ohne Rechtsklick)
    await zeilen.nth(2).locator('[data-action="remove"]').click();   // Apfel ohne Fläche
    await expect(zeilen).toHaveCount(4);
    await expect(zahlen).toHaveText('4 Bäume · 3 Obstarten');
    await expect(filter).toHaveText(['Alle 4', 'Apfel 2', 'Birne 1', 'Mirabelle 1']);
    await undo.click();                                              // die Mirabelle
    await expect(zahlen).toHaveText('3 Bäume · 2 Obstarten');
    await expect(page.locator('#map .tree-marker-icon')).toHaveCount(3);
    await undo.click();
    await undo.click();
    await undo.click();
    await expect(zahlen).toHaveText('Noch keine Bäume erfasst.');
    await expect(undo).toBeDisabled();
    await expect(page.locator('#obstbaum-table-body')).toContainText('Noch keine Bäume erfasst.');
  });
}
