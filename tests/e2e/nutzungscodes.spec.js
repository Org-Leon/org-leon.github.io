import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud, TEST_USER } from './helpers.js';
import { ladeShapeZip, rechteck } from './shapefile-helper.js';

// Gemeinsame Nutzungscodes (Tabelle "nutzungscodes", supabase/nutzungscodes.sql):
// Thüringer Flächen nur mit Code -> in der Flächenübersicht Kultur eintragen
// bzw. Nutzungsnachweis laden; jede Zuordnung geht als Vorschlag an die
// Verwaltung, freigegebene Codes übersetzen die Flächen aller Nutzer.
// Server per window.__ffTestCodes gestubbt (supabase.js). Alle Daten erfunden.

const CODES_STUB = (rows) => {
  window.__ffTestCodes = {
    rows,
    async laden() { return JSON.parse(JSON.stringify(this.rows)); },
    async vorschlagen(rs) { rs.forEach(r => this.rows.push({ ...r, status: 'vorschlag', vorgeschlagen_von: 'test-user', id: this.rows.length + 1 })); },
    async entscheiden({ land, code, kultur, freigeben }) {
      this.rows.forEach(r => {
        if (r.land !== land || r.code !== code) return;
        if (r.kultur === kultur) r.status = freigeben ? 'freigegeben' : 'abgelehnt';
        else if (freigeben && r.status !== 'abgelehnt') r.status = 'abgelehnt';
      });
    }
  };
};
// Thüringen (VERONA 2026): SCHLAG, FLAECHE_HA, KULTURART-Code, FBI = FLIK
const TH_FELDER = [['ID', 'N', 10], ['FLAECHE_HA', 'N', 12, 4], ['SCHLAG', 'C', 10], ['ANTJAHR', 'C', 4], ['KULTURART', 'C', 10], ['FBI', 'C', 20]];
const TH = [
  ['1', 'DETHLIAL99999A01', 10, '111150'],  // in der amtlichen Tabelle
  ['2', 'DETHLIAL99999B02', 4, '999001'],   // unbekannt
  ['3', 'DETHLIAL99999C03', 2.5, '999001'], // unbekannt
  ['4', 'DETHLIGL99999D04', 1.5, '999002']  // von der Verwaltung schon freigegeben
];
const ladeTh = (page) => ladeShapeZip(page, 'file-input', 'Antrag_Thueringen.zip', 'Antragsflächen Hauptnutzung_POLYGONE', TH_FELDER,
  TH.map(([schlag, fbi, ha, code], i) => [9000 + i, ha.toFixed(4), schlag, '2026', code, fbi]), TH.map((_, i) => rechteck(i)));
const uebersicht = (page) => page.locator('.segment-btn[data-view="uebersicht"]').click();

test.describe('Gemeinsame Nutzungscodes', () => {
  test('Übersicht: fehlende Kultur eintragen -> gilt sofort, geht als Vorschlag an die Verwaltung; Freigegebenes wird übernommen', async ({ page }) => {
    await page.addInitScript(CODES_STUB, [{ id: 1, land: 'TH', code: '999002', kultur: 'Geteilte Testkultur', quelle: 'fnn', status: 'freigegeben', vorgeschlagen_von: 'jemand' }]);
    await page.goto('/');
    await page.evaluate(() => { ['feldfolio-nutzungscodes', 'feldfolio-nutzungscodes-geteilt', 'feldfolio-nutzungscodes-ausstehend'].forEach(k => localStorage.removeItem(k)); });
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('feldfolio-nutzungscodes-geteilt') || '{}'))).toEqual({ TH: { 999002: 'Geteilte Testkultur' } });
    await ladeTh(page);
    await uebersicht(page);

    const karte = page.locator('#ue-codes');
    await expect(karte).toBeVisible();
    await expect(karte).toContainText('2 Flächen nur mit Nutzungscode (1 Code)');
    const zeile = karte.locator('.ue-code-row');
    await expect(zeile).toHaveCount(1);
    await expect(zeile).toContainText('999001');
    await expect(zeile).toContainText('Thüringen · 2 Flächen · 6,50 ha');
    // freigegebener Code ist schon übersetzt
    await expect(page.locator('#uebersicht-view')).toContainText('Geteilte Testkultur');

    await zeile.locator('.ue-code-input').fill('Eigene Testkultur');
    await zeile.locator('[data-ue-code-ok]').click();
    await expect(karte.locator('.ue-code-row')).toHaveCount(0);
    await expect(karte).toContainText('als Vorschlag gemeldet');
    await expect(page.locator('#uebersicht-view')).toContainText('Eigene Testkultur');
    // Vorschlag ist beim Server angekommen
    await expect.poll(() => page.evaluate(() => window.__ffTestCodes.rows.filter(r => r.status === 'vorschlag').map(r => [r.land, r.code, r.kultur, r.quelle])))
      .toEqual([['TH', '999001', 'Eigene Testkultur', 'manuell']]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('feldfolio-nutzungscodes-ausstehend') || '[]'))).toEqual([]);
  });

  test('Übersicht: Nutzungsnachweis (PDF) laden lernt den Code und meldet ihn als Vorschlag', async ({ page }) => {
    await page.addInitScript(CODES_STUB, []);
    await page.goto('/');
    await page.evaluate(() => { ['feldfolio-nutzungscodes', 'feldfolio-nutzungscodes-geteilt', 'feldfolio-nutzungscodes-ausstehend'].forEach(k => localStorage.removeItem(k)); });
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await ladeTh(page);
    await uebersicht(page);
    // Ausdruck wie in Thüringen: Schlag, FLIK, "Code: Text", Größe in einer Zeile
    const b64 = await page.evaluate(() => {
      const doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
      doc.setFontSize(8);
      [[[22, '2'], [45, 'DETHLIAL99999B02'], [85, '999001: Gelernte Testkultur'], [223, '4,0000 ha']],
       [[22, '4'], [45, 'DETHLIGL99999D04'], [85, '999002: Zweite Testkultur'], [223, '1,5000 ha']]]
        .forEach((z, i) => z.forEach(([x, t]) => doc.text(t, x, 20 + i * 6)));
      return doc.output('datauristring').split(',')[1];
    });
    await page.setInputFiles('#ue-fnn-file', { name: 'FNN.pdf', mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') });
    const karte = page.locator('#ue-codes');
    await expect(karte).toContainText('FNN.pdf: 2 Nutzungscodes erkannt', { timeout: 30000 });
    await expect(karte.locator('.ue-code-row')).toHaveCount(0);
    await expect(page.locator('#uebersicht-view')).toContainText('Gelernte Testkultur');
    await expect.poll(() => page.evaluate(() => window.__ffTestCodes.rows.map(r => [r.code, r.kultur, r.quelle]).sort()))
      .toEqual([['999001', 'Gelernte Testkultur', 'fnn'], ['999002', 'Zweite Testkultur', 'fnn']]);
  });

  test('Ohne Konto: Zuordnung gilt lokal, Vorschlag wird beim Anmelden nachgereicht', async ({ page }) => {
    await page.addInitScript(CODES_STUB, []);
    await page.goto('/');
    await page.evaluate(() => { ['feldfolio-nutzungscodes', 'feldfolio-nutzungscodes-geteilt', 'feldfolio-nutzungscodes-ausstehend'].forEach(k => localStorage.removeItem(k)); });
    await ladeTh(page);
    await uebersicht(page);
    const karte = page.locator('#ue-codes');
    await expect(karte).toContainText('Mit Konto wird jede Zuordnung als Vorschlag für alle Nutzer geteilt');
    await karte.locator('.ue-code-row', { hasText: '999002' }).locator('.ue-code-input').fill('Testgras');
    await karte.locator('.ue-code-row', { hasText: '999002' }).locator('.ue-code-input').press('Enter');
    await expect(page.locator('#uebersicht-view')).toContainText('Testgras');
    expect(await page.evaluate(() => window.__ffTestCodes.rows.length)).toBe(0);
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await expect.poll(() => page.evaluate(() => window.__ffTestCodes.rows.map(r => [r.code, r.kultur]))).toEqual([['999002', 'Testgras']]);
  });

  test('Verwaltung: Vorschläge je Code freigeben (andere Varianten abgelehnt) -> gilt für alle', async ({ page }) => {
    await page.addInitScript(CODES_STUB, [
      { id: 1, land: 'TH', code: '999003', kultur: 'Kultur A', quelle: 'fnn', status: 'vorschlag', vorgeschlagen_von: 'u1' },
      { id: 2, land: 'TH', code: '999003', kultur: 'Kultur A', quelle: 'manuell', status: 'vorschlag', vorgeschlagen_von: 'u2' },
      { id: 3, land: 'TH', code: '999003', kultur: 'Kultur B', quelle: 'manuell', status: 'vorschlag', vorgeschlagen_von: 'u3' }
    ]);
    await page.addInitScript(() => { window.__ffTestAdmin = true; }); // Admin laut Server (admin_konten)
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page, { ...TEST_USER, email: 'admin@oekop.de' });
    await page.locator('#btn-account').click();
    await page.locator('#account-menu-admin').click();
    const liste = page.locator('#account-admin-codes-list');
    await expect(liste.locator('.admin-code-row')).toHaveCount(1);
    await expect(liste).toContainText('Thüringen · Code 999003');
    const a = liste.locator('.admin-code-variante', { hasText: 'Kultur A' });
    await expect(a).toContainText('2 Nutzer');
    await expect(a).toContainText('Nutzungsnachweis, eingetragen');
    await a.locator('[data-code-entscheid="1"]').click();
    await expect(liste).toContainText('Keine offenen Vorschläge');
    await expect(liste).toContainText('1 Code ist für alle freigegeben');
    expect(await page.evaluate(() => window.__ffTestCodes.rows.map(r => r.status))).toEqual(['freigegeben', 'freigegeben', 'abgelehnt']);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('feldfolio-nutzungscodes-geteilt') || '{}'))).toEqual({ TH: { 999003: 'Kultur A' } });
  });
});
