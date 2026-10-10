import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud } from './helpers.js';

// Checkliste je Termin (src/checkliste.js): eigene Punkte schreiben, abhaken,
// löschen; liegt am Termin und wird abgeglichen; persönliche Vorlage im Profil.
// Dieselbe Liste im Dashboard-Baustein, in der Kontrollmappe und auf der
// Betriebsseite. Alle Daten frei erfunden.
async function start(page) {
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await loginWithCloud(page);
  await page.locator('#kontrolle-switcher').click();
  const ids = await page.evaluate(() => {
    const tag = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
    return {
      a: window.__ffTestTk.addEvent({ kunde: 'Hof Alpha', auditart: 'Jahresinspektion', date: tag(0) }),
      b: window.__ffTestTk.addEvent({ kunde: 'Hof Beta', auditart: 'Probenahme', date: tag(3) })
    };
  });
  await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
  await page.locator('#kontrolle-tabs [data-ko-tab="uebersicht"]').click();
  return ids;
}
async function bausteinEinblenden(page, id) {
  await page.locator('#ko-dash-anpassen').click();
  await page.locator(`.ko-w-neu[data-w="${id}"]`).click();
  await page.locator('#ko-dash-anpassen').click(); // Fertig
}
const punkte = (ort) => ort.locator('.cl-punkt').evaluateAll(els => els.map(el => (el.classList.contains('is-erledigt') ? '[x] ' : '[ ] ') + el.querySelector('label span').textContent));
const amTermin = (page, id) => page.evaluate((i) => (window.__ffTestTk.getEvent(i).checkliste || []).map(p => [p.text, p.erledigt]), id);
const inDerCloud = (page) => page.evaluate(async () => { await window.__ffTestOffline.sync(); return window.__ffTestCloud.row.data; });

test.describe('Checkliste je Termin', () => {
  test('Dashboard-Baustein: schreiben, abhaken, löschen — am Termin gespeichert; Vorlage für andere Termine', async ({ page }) => {
    const ids = await start(page);
    await bausteinEinblenden(page, 'checkliste');
    const baustein = page.locator('[data-w-id="checkliste"]');
    await expect(baustein.locator('.cl-termin')).toContainText('Hof Alpha'); // nächster Termin
    await expect(baustein.locator('.cl-leer')).toBeVisible();

    // schreiben: Enter fügt hinzu, der Cursor bleibt im Feld
    await baustein.locator('.cl-eingabe').fill('Lieferantenliste prüfen');
    await baustein.locator('.cl-eingabe').press('Enter');
    await expect(baustein.locator('.cl-eingabe')).toBeFocused();
    await page.keyboard.type('Stallbuch ansehen');
    await page.keyboard.press('Enter');
    await baustein.locator('.cl-eingabe').fill('   ');
    await baustein.locator('[data-cl-akt="neu"]').click(); // leer: nichts passiert
    expect(await punkte(baustein)).toEqual(['[ ] Lieferantenliste prüfen', '[ ] Stallbuch ansehen']);

    // abhaken
    await baustein.locator('.cl-punkt input').first().check();
    await expect(baustein.locator('.cl-stand')).toHaveText('1 von 2 erledigt');
    expect(await punkte(baustein)).toEqual(['[x] Lieferantenliste prüfen', '[ ] Stallbuch ansehen']);
    expect(await amTermin(page, ids.a)).toEqual([['Lieferantenliste prüfen', true], ['Stallbuch ansehen', false]]);
    await expect.poll(async () => ((await inDerCloud(page)).terminkalenderEvents.find(e => e.kunde === 'Hof Alpha').checkliste || []).map(p => p.text))
      .toEqual(['Lieferantenliste prüfen', 'Stallbuch ansehen']);

    // als Vorlage merken
    await baustein.locator('[data-cl-akt="vorlage-speichern"]').click();
    await expect(page.locator('#ff-toast')).toHaveText('Vorlage gespeichert (2 Punkte).');
    await expect.poll(async () => (await inDerCloud(page)).profil.checkliste).toEqual(['Lieferantenliste prüfen', 'Stallbuch ansehen']);

    // löschen
    await baustein.locator('.cl-weg').nth(1).click();
    expect(await punkte(baustein)).toEqual(['[x] Lieferantenliste prüfen']);

    // anderer Termin: Vorlage einfügen (unabgehakt), eigene Punkte dazu
    await page.locator('#ko-agenda [data-open-termin]', { hasText: 'Hof Beta' }).click();
    const mappe = page.locator('#kontrollmappe .cl');
    await expect(mappe.locator('.cl-leer')).toBeVisible();
    await mappe.locator('[data-cl-akt="vorlage-laden"]').click();
    expect(await punkte(mappe)).toEqual(['[ ] Lieferantenliste prüfen', '[ ] Stallbuch ansehen']);
    await expect(mappe.locator('[data-cl-akt="vorlage-laden"]')).toHaveCount(0); // alles schon drin
    expect(await amTermin(page, ids.b)).toEqual([['Lieferantenliste prüfen', false], ['Stallbuch ansehen', false]]);
    expect(await amTermin(page, ids.a)).toEqual([['Lieferantenliste prüfen', true]]); // je Termin getrennt
  });

  test('Betriebsseite und Dashboard zeigen dieselbe Liste; Tippen wird durch einen Abgleich nicht unterbrochen', async ({ page }) => {
    await start(page);
    await page.evaluate(() => window.__ffTestOffline.sync());
    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof Alpha'));
    await page.locator('#betrieb-switcher').click();
    const kachel = page.locator('[data-kb-tile="checkliste"]');
    await kachel.locator('.cl-eingabe').fill('Halb getippt');
    // von einem anderen Gerät kommt eine Änderung herein -> die Seite wird aufgefrischt
    await page.evaluate(() => window.__ffTestCloud.setRemote(d => { d.manualBetriebe = [...(d.manualBetriebe || []), 'Hof Fern']; }));
    await page.evaluate(() => window.__ffTestSync.ping());
    await page.waitForTimeout(600);
    await expect(kachel.locator('.cl-eingabe')).toBeFocused();
    await expect(kachel.locator('.cl-eingabe')).toHaveValue('Halb getippt');
    await page.keyboard.press('Enter');
    expect(await punkte(kachel)).toEqual(['[ ] Halb getippt']);

    // derselbe Termin im Dashboard-Baustein (gewählter Betrieb geht vor)
    await page.locator('#kontrolle-switcher').click();
    await bausteinEinblenden(page, 'checkliste');
    const baustein = page.locator('[data-w-id="checkliste"]');
    expect(await punkte(baustein)).toEqual(['[ ] Halb getippt']);
    await baustein.locator('.cl-punkt input').check();
    await page.locator('#betrieb-switcher').click();
    expect(await punkte(page.locator('[data-kb-tile="checkliste"]'))).toEqual(['[x] Halb getippt']);
  });

  test('Liste von einem anderen Gerät wird bereinigt übernommen', async ({ page }) => {
    const ids = await start(page);
    await page.evaluate(() => window.__ffTestOffline.sync());
    await page.evaluate((id) => window.__ffTestCloud.setRemote(d => {
      d.terminkalenderEvents.find(e => e.id === id).checkliste = [{ text: '  Hofrundgang  ' }, { text: '' }, 'kaputt', { id: 7, text: 'Etiketten', erledigt: 'ja' }];
    }), ids.a);
    await page.evaluate(() => window.__ffTestSync.ping());
    await expect.poll(() => amTermin(page, ids.a)).toEqual([['Hofrundgang', false], ['Etiketten', true]]);
  });
});
