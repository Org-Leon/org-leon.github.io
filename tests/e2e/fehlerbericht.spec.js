import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud, TEST_USER } from './helpers.js';

// Fehler melden (src/fehlerbericht.js): Formular nach üblichem Fehlerbericht-
// Aufbau, technische Angaben und Protokoll (bereinigt), Bildschirmfoto freiwillig,
// Warteschlange ohne Netz, "Meine Meldungen", Verwaltung für Admins.
// Server per window.__ffTestFehler gestubbt (supabase.js). Alle Daten erfunden.
function FEHLER_STUB(start) {
  window.__ffTestFehler = {
    zeilen: (start || []).map(z => ({ ...z })),
    updates: [],
    async senden(z) {
      const i = this.zeilen.findIndex(x => x.client_id === z.client_id);
      if (i >= 0) return { nummer: i + 1 };
      this.zeilen.push({ ...z, status: 'neu' });
      return { nummer: this.zeilen.length };
    },
    async laden() {
      return this.zeilen.map((z, i) => ({ ...z, screenshot: undefined, id: 'id' + i, nummer: i + 1, erstellt_am: '2026-10-09T08:00:00Z',
        email: z.email || 'test@example.com', status: z.status || 'neu', hat_bild: !!z.screenshot, umgebung: z.umgebung || {}, protokoll: z.protokoll || [] }));
    },
    async bild(id) { return this.zeilen[Number(id.slice(2))].screenshot || null; },
    async aktualisieren(id, felder) { this.updates.push({ id, ...felder }); Object.assign(this.zeilen[Number(id.slice(2))], felder); }
  };
}
const gesendet = (page) => page.evaluate(() => window.__ffTestFehler.zeilen);
async function start(page, { email = TEST_USER.email, zeilen = [], admin = false } = {}) {
  await page.addInitScript(FEHLER_STUB, zeilen);
  if (admin) await page.addInitScript(() => { window.__ffTestAdmin = true; }); // Admin laut Server (admin_konten)
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await loginWithCloud(page, { ...TEST_USER, email });
}
async function oeffnen(page) {
  await page.locator('#btn-account').click();
  await page.locator('#account-menu-fehler').click();
  await expect(page.locator('#fb-overlay')).toBeVisible();
}
// Einträge im Offline-Speicher (Warteschlange)
const wartend = (page) => page.evaluate(async () => {
  const db = await new Promise(r => { const q = indexedDB.open('feldfolio-offline'); q.onsuccess = () => r(q.result); });
  return new Promise(r => { const q = db.transaction('fehlerberichte').objectStore('fehlerberichte').count(); q.onsuccess = () => { db.close(); r(q.result); }; });
});

test.describe('Fehler melden', () => {
  test('Fehler mit Schritten, Erwartet/Tatsächlich, Auswirkung — technische Angaben bereinigt', async ({ page }) => {
    await start(page);
    // ein Programmfehler und eine Konsolenmeldung mit persönlichen Angaben
    await page.evaluate(() => {
      setTimeout(() => { throw new Error('Testfehler bei max@example.org Ohrmarke DE 0123456789'); }, 0);
      console.error('Konsole: token=geheim123 von anna@example.org');
    });
    await page.locator('#kontrolle-switcher').click();
    await oeffnen(page);
    await expect(page.locator('#fb-titel-kopf')).toHaveText('Fehler melden');
    await expect(page.locator('input[name="fb-art"][value="fehler"]')).toBeChecked();

    // Pflichtfeld
    await page.locator('#fb-senden').click();
    await expect(page.locator('#fb-status')).toContainText('Bitte kurz beschreiben');

    await page.locator('#fb-titel').fill('Export bricht ab');
    await page.locator('#fb-schritte').fill('1. Schlagliste öffnen\n2. Exportieren');
    await page.locator('#fb-erwartet').fill('Excel-Datei wird gespeichert');
    await page.locator('#fb-tatsaechlich').fill('Nichts passiert');
    await page.locator('#fb-schwere').selectOption('hoch');
    await page.locator('#fb-haeufigkeit').selectOption('immer');

    // was mitgeht, ist vorher einsehbar — ohne E-Mail-Adressen, Nummern, Schlüssel
    await page.locator('.fb-technik summary').click();
    const technik = page.locator('#fb-technik-text');
    await expect(technik).toContainText('version:');
    await expect(technik).toContainText('Testfehler bei <E-Mail>');
    await expect(technik).toContainText('<Nummer>');
    await expect(technik).toContainText('token=<entfernt>');
    await expect(technik).toContainText('#kontrolle-switcher');
    await expect(technik).not.toContainText('max@example.org');
    // Bildschirmfoto: vorbereitet, aber nicht angehakt
    await expect(page.locator('#fb-bild-vorschau')).toBeVisible();
    await expect(page.locator('#fb-bild-an')).not.toBeChecked();

    await page.locator('#fb-senden').click();
    await expect(page.locator('#fb-status')).toHaveText('Danke! Gemeldet als #1.');
    await expect(page.locator('#fb-overlay')).toBeHidden();
    const [z] = await gesendet(page);
    expect(z).toMatchObject({ art: 'fehler', titel: 'Export bricht ab', schritte: '1. Schlagliste öffnen\n2. Exportieren',
      erwartet: 'Excel-Datei wird gespeichert', tatsaechlich: 'Nichts passiert', schwere: 'hoch', haeufigkeit: 'immer', screenshot: null });
    expect(z.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(z.umgebung).toMatchObject({ angemeldet: true, ansicht: 'kontrolle', online: true });
    expect(z.umgebung.version).toBeTruthy();
    expect(z.protokoll.some(p => p.art === 'fehler' && p.text.includes('Testfehler'))).toBe(true);
    expect(z.protokoll.some(p => p.art === 'klick' && p.text === '#kontrolle-switcher')).toBe(true);
    const alles = JSON.stringify(z);
    expect(alles).not.toContain('max@example.org');
    expect(alles).not.toContain('anna@example.org');
    expect(alles).not.toContain('0123456789');
    expect(alles).not.toContain('geheim123');
  });

  test('Verbesserung mit Bildschirmfoto; „Meine Meldungen“ zeigt den Stand', async ({ page }) => {
    await start(page);
    await oeffnen(page);
    await page.locator('.fb-art label', { hasText: 'Verbesserung' }).click();
    await expect(page.locator('#fb-titel-kopf')).toHaveText('Verbesserung vorschlagen');
    await expect(page.locator('#fb-erwartet')).toBeHidden();
    await expect(page.locator('#fb-haeufigkeit')).toBeHidden();
    await page.locator('#fb-titel').fill('Kalender nach Landkreis filtern');
    await page.locator('#fb-schritte').fill('Für die Tourenplanung');
    await expect(page.locator('#fb-bild-an')).toBeEnabled();
    await page.locator('#fb-bild-an').check();
    await page.locator('#fb-senden').click();
    await expect(page.locator('#fb-overlay')).toBeHidden();
    const [z] = await gesendet(page);
    expect(z).toMatchObject({ art: 'verbesserung', erwartet: '', tatsaechlich: '', haeufigkeit: 'unbekannt' });
    expect(z.screenshot).toMatch(/^data:image\/jpeg;base64,/);
    expect(z.screenshot.length).toBeLessThan(1400000);

    // Bearbeitung beim Team -> Stand für den Melder sichtbar
    await page.evaluate(() => { window.__ffTestFehler.zeilen[0].status = 'in_arbeit'; });
    await oeffnen(page);
    await page.locator('[data-fb-reiter="meine"]').click();
    const zeile = page.locator('#fb-meine-liste .fb-zeile');
    await expect(zeile).toHaveCount(1);
    await expect(zeile).toContainText('#1');
    await expect(zeile).toContainText('Kalender nach Landkreis filtern');
    await expect(zeile.locator('.fb-chip')).toHaveText('In Arbeit');
  });

  test('Eigenes Bild statt Bildschirmfoto', async ({ page }) => {
    await start(page);
    await oeffnen(page);
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await page.setInputFiles('#fb-bild-datei', { name: 'foto.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('#fb-bild-status')).toHaveText('Eigenes Bild gewählt.');
    await expect(page.locator('#fb-bild-an')).toBeChecked();
    await page.locator('#fb-titel').fill('Mit eigenem Bild');
    await page.locator('#fb-senden').click();
    await expect(page.locator('#fb-overlay')).toBeHidden();
    expect((await gesendet(page))[0].screenshot).toMatch(/^data:image\/jpeg;base64,/);
  });

  test('Ohne Internet: vorgemerkt und beim Wiederverbinden gesendet', async ({ page, context }) => {
    await start(page);
    await context.setOffline(true);
    await oeffnen(page);
    await page.locator('#fb-titel').fill('Gemeldet im Stall');
    await page.locator('#fb-senden').click();
    await expect(page.locator('#fb-status')).toContainText('Ohne Internet gespeichert');
    expect(await gesendet(page)).toHaveLength(0);
    expect(await wartend(page)).toBe(1);
    await expect(page.locator('#fb-overlay')).toBeHidden();
    await oeffnen(page);
    await page.locator('[data-fb-reiter="meine"]').click();
    await expect(page.locator('#fb-meine-liste')).toContainText('wartet auf Internet');
    await page.keyboard.press('Escape');
    await context.setOffline(false);
    await expect.poll(() => gesendet(page).then(l => l.map(z => z.titel))).toEqual(['Gemeldet im Stall']);
    await expect.poll(() => wartend(page)).toBe(0);
  });

  test('Verwaltung: Vorgänge filtern, bearbeiten, als Markdown weitergeben', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const basis = { art: 'fehler', schwere: 'hoch', haeufigkeit: 'immer', schritte: '1. Öffnen', erwartet: 'Liste', tatsaechlich: 'Leer',
      umgebung: { version: '0.0.1', browser: 'Chrome 153' }, protokoll: [{ t: '2026-10-09T08:00:00Z', art: 'klick', text: '#btn-x' }] };
    await start(page, { email: 'leitung@oekop.de', admin: true, zeilen: [
      { ...basis, client_id: 'aaaaaaaa-1', titel: 'Liste bleibt leer', email: 'kontrolle@example.org' },
      { ...basis, client_id: 'aaaaaaaa-2', titel: 'Alter Fehler', status: 'erledigt' }
    ] });
    await page.locator('#btn-account').click();
    await page.locator('#account-menu-admin').click();
    const liste = page.locator('#fb-admin-liste');
    await expect(liste.locator('.fb-vorgang')).toHaveCount(1); // nur offene
    await page.locator('#fb-admin-filter').selectOption('alle');
    await expect(liste.locator('.fb-vorgang')).toHaveCount(2);
    const v = liste.locator('.fb-vorgang', { hasText: 'Liste bleibt leer' });
    await expect(v.locator(':scope > summary')).toContainText('#1');
    await expect(v.locator(':scope > summary')).toContainText('kontrolle@example.org');
    await v.locator(':scope > summary').click();
    await expect(v).toContainText('Schritte zum Nachstellen');
    await v.locator('[data-fb-feld="status"]').selectOption('duplikat');
    await expect(v.locator('[data-fb-feld="duplikat_von"]')).toBeVisible();
    await v.locator('[data-fb-feld="duplikat_von"]').fill('2');
    await v.locator('[data-fb-feld="prioritaet"]').selectOption('p2');
    await v.locator('[data-fb-feld="notiz"]').fill('Wie #2');
    await v.locator('[data-fb-akt="speichern"]').click();
    const neu = liste.locator('.fb-vorgang', { hasText: 'Liste bleibt leer' });
    await expect(neu.locator('[data-fb-meldung]')).toHaveText('Gespeichert.');
    await expect(neu.locator(':scope > summary .fb-chip.is-duplikat')).toHaveText('Duplikat');
    await expect(neu.locator(':scope > summary .fb-chip.is-prio')).toHaveText('P2');
    expect(await page.evaluate(() => window.__ffTestFehler.updates)).toEqual([{ id: 'id0', status: 'duplikat', prioritaet: 'p2', notiz: 'Wie #2', duplikat_von: 2 }]);

    await neu.locator('[data-fb-akt="kopieren"]').click();
    await expect(neu.locator('[data-fb-meldung]')).toHaveText('Kopiert.');
    const md = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'); // Windows-Zwischenablage: CRLF
    expect(md).toContain('## #1 Liste bleibt leer');
    expect(md).toContain('**Status:** Duplikat');
    expect(md).toContain('### Schritte zum Nachstellen\n1. Öffnen');
    expect(md).toContain('| version | 0.0.1 |');
    expect(md).toContain('#btn-x');

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#fb-admin-export').click()]);
    expect(download.suggestedFilename()).toMatch(/^fehlerberichte-\d{4}-\d{2}-\d{2}\.md$/);
  });

  test('Hinweis bei Programmfehlern führt zum vorbelegten Bericht', async ({ page }) => {
    await page.addInitScript(() => { window.__ffTestFehlerHinweis = true; });
    await start(page);
    await page.evaluate(() => { setTimeout(() => { throw new Error('Kaputt beim Speichern'); }, 0); });
    await expect(page.locator('#fb-hinweis')).toBeVisible();
    await page.locator('#fb-hinweis-melden').click();
    await expect(page.locator('#fb-overlay')).toBeVisible();
    await expect(page.locator('#fb-tatsaechlich')).toHaveValue('Fehlermeldung: Kaputt beim Speichern');
  });
});
