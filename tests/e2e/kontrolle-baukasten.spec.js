import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud, gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Kontrolle: Übersicht als Baukasten (Bausteine wählen, frei anordnen, Größe;
// gespeichert im Profil) und der Dateiexplorer im Reiter "Dokumente".
// Alle Daten frei erfunden.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function termine(page) {
  return page.evaluate(() => {
    const tag = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
    const a = window.__ffTestTk.addEvent({ kunde: 'Hof Alpha', auditart: 'Jahresinspektion', date: tag(0), bestaetigt: true, lat: 48.45, lng: 12.1, address: 'Hofweg 1',
      attachments: [
        { path: 'a/liste.jpg', name: '2026_Hof Alpha_Lieferantenliste.jpg', type: 'image/jpeg', size: 480000, addedAt: '2026-10-08T09:00:00Z' },
        { path: 'a/hit.pdf', name: '2026_Hof Alpha_HIT-Auszug.pdf', type: 'application/pdf', size: 1250000, addedAt: '2026-10-08T10:00:00Z' }] });
    const b = window.__ffTestTk.addEvent({ kunde: 'Hof Beta', auditart: 'Probenahme', date: tag(2), unangemeldet: true,
      attachments: [{ path: 'b/etikett.jpg', name: '2026_Hof Beta_Etikett.jpg', type: 'image/jpeg', size: 220000 }] });
    const c = window.__ffTestTk.addEvent({ kunde: 'Hof Alpha', auditart: 'Nachkontrolle', date: tag(9),
      attachments: [{ path: 'c/beleg.pdf', name: '2026_Hof Alpha_Verstoß Beleg.pdf', type: 'application/pdf', size: 64000 }] });
    return { a, b, c };
  });
}
async function start(page, { cloud = true } = {}) {
  await page.goto('/');
  if (cloud) { await setupCloud(page, { workspaces: {} }); await loginWithCloud(page); }
  else await page.evaluate(() => window.__ffTestTk.loginFake());
  await page.locator('#kontrolle-switcher').click();
  const ids = await termine(page);
  await page.locator('#kontrolle-tabs [data-ko-tab="uebersicht"]').click();
  return ids;
}
// Plätze im Raster (12 Spalten): { id: [x, y, w, h] }
const plaetze = (page) => page.locator('#ko-dash .grid-stack-item').evaluateAll(els => Object.fromEntries(els.map(e => [e.getAttribute('gs-id'), ['x', 'y', 'w', 'h'].map(k => e.gridstackNode[k])])));
const gespeichert = (page) => page.evaluate(async () => {
  await window.__ffTestOffline.sync();
  return Object.fromEntries((window.__ffTestCloud.row.data.profil.dashboard || []).map(x => [x.id, [x.x, x.y, x.w, x.h]]));
});
const STANDARD = {
  kennzahlen: [0, 0, 12, 2], agenda: [0, 2, 6, 8], karte: [6, 2, 6, 8],
  dokumente: [0, 10, 6, 7], protokolle: [6, 10, 6, 7], schnell: [0, 17, 12, 3]
};

test.describe('Kontrolle: Übersicht als Baukasten', () => {
  test('Standard-Bausteine; anpassen: ausblenden, hinzufügen — im Profil gespeichert', async ({ page }) => {
    await start(page);
    expect(await plaetze(page)).toEqual(STANDARD);
    await expect(page.locator('#ko-kpis .ko-kpi')).toHaveCount(3);
    await expect(page.locator('[data-w-id="dokumente"] .ko-w-zeile').first()).toContainText('HIT-Auszug'); // zuletzt hinzugefügt
    await expect(page.locator('#ko-w-karte .leaflet-interactive')).toHaveCount(1);                       // nur Hof Alpha hat Koordinaten
    await expect(page.locator('#ko-dash .ui-resizable-handle:visible')).toHaveCount(0);                 // ohne "Anpassen" fest

    // Bearbeiten
    await page.locator('#ko-dash-anpassen').click();
    await expect(page.locator('#ko-dash-anpassen')).toContainText('Fertig');
    await expect(page.locator('#ko-dash-luecken')).toBeVisible();
    await expect(page.locator('.ko-w-hinzu .ko-w-neu')).toHaveCount(4); // Zu erledigen, Aktueller Betrieb, Aufträge nach Art, Meine Notiz
    await page.locator('[data-w-id="karte"] [data-w-akt="weg"]').click();
    await page.locator('.ko-w-neu[data-w="offen"]').click();
    const neu = await plaetze(page);
    expect(Object.keys(neu).sort()).toEqual(['agenda', 'dokumente', 'kennzahlen', 'offen', 'protokolle', 'schnell']);
    expect(neu.offen).toEqual([0, 20, 6, 7]);                                        // unten angehängt, Startgröße
    await expect(page.locator('.ko-w-neu[data-w="karte"]')).toBeVisible();          // ausgeblendet -> wieder wählbar
    await page.locator('#ko-dash-anpassen').click();
    await expect(page.locator('.ko-w-hinzu')).toHaveCount(0);
    await expect(page.locator('#ko-dash-luecken')).toBeHidden();
    // "Zu erledigen": Hof Beta ist unbestätigt und unangemeldet
    await expect(page.locator('[data-w-id="offen"]')).toContainText('unbestätigt, unangemeldet');

    // im Profil gespeichert (Cloud) -> gilt auf allen Geräten
    await expect.poll(() => gespeichert(page)).toEqual(neu);

    // Standard wiederherstellen
    page.once('dialog', d => d.accept());
    await page.locator('#ko-dash-anpassen').click();
    await page.locator('#ko-dash-standard').click();
    expect(await plaetze(page)).toEqual(STANDARD);
  });

  test('Layout von einem anderen Gerät wird übernommen (auch altes Format); Notiz wird gespeichert', async ({ page }) => {
    await start(page);
    await page.evaluate(() => window.__ffTestOffline.sync());
    // altes Format: zweispaltige Liste mit "breit" -> wird in Rasterplätze umgerechnet
    await page.evaluate(() => window.__ffTestCloud.setRemote(d => { d.profil = { ...(d.profil || {}), dashboard: [{ id: 'notiz', breit: true }, { id: 'agenda', breit: false }, { id: 'karte' }, { id: 'gibtsnicht' }] }; }));
    await page.evaluate(() => window.__ffTestSync.ping());
    await expect.poll(() => plaetze(page)).toEqual({ notiz: [0, 0, 12, 5], agenda: [0, 5, 6, 8], karte: [6, 5, 6, 8] }); // unbekannter Baustein wird ignoriert
    // neues Format mit freien Plätzen (Lücke bleibt stehen)
    await page.evaluate(() => window.__ffTestCloud.setRemote(d => { d.profil.dashboard = [{ id: 'notiz', x: 0, y: 0, w: 4, h: 5 }, { id: 'agenda', x: 8, y: 3, w: 4, h: 6 }]; }));
    await page.evaluate(() => window.__ffTestSync.ping());
    await expect.poll(() => plaetze(page)).toEqual({ notiz: [0, 0, 4, 5], agenda: [8, 3, 4, 6] });
    await page.locator('#ko-notiz').fill('Probenbehälter nachbestellen');
    await expect.poll(() => page.evaluate(async () => { await window.__ffTestOffline.sync(); return window.__ffTestCloud.row.data.profil.notiz; }), { timeout: 8000 }).toBe('Probenbehälter nachbestellen');
  });

  test('Bausteine führen weiter: Termin, Dokument, Reiter', async ({ page, context }) => {
    await context.route('https://dv.test/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await start(page, { cloud: false });
    await page.evaluate(() => { window.__ffTestPhotoUrlOverride = async (p) => 'https://dv.test/' + encodeURIComponent(p); });
    // Schnellzugriff -> Dokumente
    await page.locator('.ko-w-schnell[data-ko-tab="dokumente"]').click();
    await expect(page.locator('#kontrolle-dokumente')).toBeVisible();
    await page.locator('#kontrolle-tabs [data-ko-tab="uebersicht"]').click();
    // Neueste Dokumente -> Viewer
    await page.locator('[data-w-id="dokumente"] .ko-w-zeile', { hasText: 'Etikett' }).click();
    await expect(page.locator('#docviewer')).toBeVisible();
    await expect(page.locator('#dv-name')).toHaveText('2026_Hof Beta_Etikett.jpg');
    await page.keyboard.press('Escape');
    // Agenda -> Kontrollmappe
    await page.locator('#ko-agenda [data-open-termin]').first().click();
    await expect(page.locator('#kontrollmappe')).toBeVisible();
  });

  test('Frei anordnen: am Kopf ziehen, Größe ändern, Lücken schließen, einspaltig am Handy', async ({ page }) => {
    await start(page);
    await page.locator('#ko-dash-anpassen').click();
    await expect(page.locator('#ko-dash .ko-w-griff')).toHaveCount(6);
    const raster = await page.locator('#ko-dash .grid-stack').boundingBox();
    const spalte = raster.width / 12;
    // "Karte" (x 6, y 2) am Kopf nach links unten unter den Schnellzugriff ziehen -> x 0, y 20: Lücke bleibt
    const kopf = await page.locator('[data-w-id="karte"] .ko-card-head h3').boundingBox();
    const sx = kopf.x + 10, sy = kopf.y + kopf.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx - 6 * spalte, sy + 18 * 48, { steps: 25 });
    await page.mouse.up();
    await expect.poll(() => plaetze(page).then(p => p.karte)).toEqual([0, 20, 6, 8]);
    expect((await plaetze(page)).agenda).toEqual([0, 2, 6, 8]); // die anderen bleiben stehen
    // Lücken schließen: die Karte rückt in die freie Stelle oben
    await page.locator('#ko-dash-luecken').click();
    await expect.poll(() => plaetze(page).then(p => p.karte[1])).toBeLessThan(20);
    // Größe: "Heute & nächste Tage" an der Ecke unten rechts zwei Spalten schmaler und zwei Zeilen höher
    const ecke = await page.locator('[gs-id="agenda"] > .ui-resizable-se').boundingBox();
    await page.mouse.move(ecke.x + ecke.width / 2, ecke.y + ecke.height / 2);
    await page.mouse.down();
    await page.mouse.move(ecke.x + ecke.width / 2 - 2 * spalte, ecke.y + ecke.height / 2 + 2 * 48, { steps: 20 });
    await page.mouse.up();
    await expect.poll(() => plaetze(page).then(p => p.agenda)).toEqual([0, 2, 4, 10]);
    // gespeichert, wie es auf dem Bildschirm steht
    const vorher = await plaetze(page);
    await expect.poll(() => gespeichert(page)).toEqual(vorher);

    // Handy: eine Spalte untereinander, zurück auf breit -> die freien Plätze sind wieder da
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator('#ko-dash .grid-stack-item').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().width))).size)).toBe(1);
    expect((await plaetze(page)).agenda[2]).toBe(1);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(() => plaetze(page)).toEqual(vorher);

    // nach "Fertig" ist das Raster fest: Ziehen ändert nichts
    await page.locator('#ko-dash-anpassen').click();
    const fest = await plaetze(page);
    const k2 = await page.locator('[data-w-id="agenda"] .ko-card-head h3').boundingBox();
    await page.mouse.move(k2.x + 10, k2.y + 5);
    await page.mouse.down();
    await page.mouse.move(k2.x + 400, k2.y + 300, { steps: 10 });
    await page.mouse.up();
    expect(await plaetze(page)).toEqual(fest);
  });

  test('Karte je Kalenderwoche: blättern, „Diese Woche“', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await page.locator('#kontrolle-switcher').click();
    // feste Wochentage statt "heute + n", damit der Test an jedem Tag gleich läuft
    const kw = await page.evaluate(() => {
      const montag = (() => { const d = new Date(); const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; })();
      const tag = (n) => { const d = new Date(montag); d.setDate(d.getDate() + n); return d; };
      window.__ffTestTk.addEvent({ kunde: 'Hof Diese Woche', date: tag(2), lat: 48.45, lng: 12.1 });
      window.__ffTestTk.addEvent({ kunde: 'Hof Nächste A', date: tag(8), lat: 48.5, lng: 12.2 });
      window.__ffTestTk.addEvent({ kunde: 'Hof Nächste B', date: tag(10), lat: 48.6, lng: 12.0 });
      window.__ffTestTk.addEvent({ kunde: 'Hof Ohne Adresse', date: tag(9) });
      return null;
    });
    expect(kw).toBeNull();
    await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
    await page.locator('#kontrolle-tabs [data-ko-tab="uebersicht"]').click();
    const karte = page.locator('[data-w-id="karte"]');
    await expect(karte.locator('#ko-w-kw')).toContainText(/KW \d+/);
    await expect(karte.locator('.ko-w-kw-zahl')).toHaveText('1 Termin');
    await expect(karte.locator('.leaflet-interactive')).toHaveCount(1);
    await expect(karte.locator('[data-ko-akt="kw-heute"]')).toHaveCount(0);
    const dieseWoche = await karte.locator('#ko-w-kw').textContent();
    // nächste Woche: drei Termine, einer ohne Adresse
    await karte.locator('[data-ko-akt="kw-vor"]').click();
    await expect(karte.locator('#ko-w-kw')).not.toHaveText(dieseWoche);
    await expect(karte.locator('.ko-w-kw-zahl')).toHaveText('3 Termine, 1 ohne Adresse');
    await expect(karte.locator('.leaflet-interactive')).toHaveCount(2);
    // übernächste: leer
    await karte.locator('[data-ko-akt="kw-vor"]').click();
    await expect(karte).toContainText('Keine Termine in dieser Woche');
    await karte.locator('[data-ko-akt="kw-heute"]').click();
    await expect(karte.locator('#ko-w-kw')).toHaveText(dieseWoche);
    await expect(karte.locator('.leaflet-interactive')).toHaveCount(1);
  });

  test('Nach dem Anmelden ist das Dashboard (Übersicht) die erste Seite', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await page.evaluate(() => { window.__ffTestAuth = { signIn: async (email) => ({ session: { user: { id: 'test-user', email } } }) }; });
    await expect(page.locator('#map-wrap')).toBeVisible(); // abgemeldet: Karte
    await page.locator('#btn-account').click();
    await page.locator('#account-email').fill('test@example.com');
    await page.locator('#account-password').fill('richtig123');
    await page.keyboard.press('Enter');
    await expect(page.locator('#account-modal-overlay')).toBeHidden();
    await expect(page.locator('#kontrolle-uebersicht')).toBeVisible();
    await expect(page.locator('#kontrolle-switcher')).toHaveClass(/active/);
    await expect(page.locator('#current-view-title')).toHaveText('Dashboard');
    await expect(page.locator('#ko-dash .ko-w').first()).toBeVisible();
  });
});

test.describe('Kontrolle: Dokumente (Dateiexplorer)', () => {
  test('Alle Dokumente, Ordner nach Betrieb und Termin, Suche, Filter, Sortierung, Kacheln', async ({ page }) => {
    await start(page, { cloud: false });
    await page.evaluate(() => { window.__ffTestPhotoUrlOverride = async () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='; });
    await expect(page.locator('#ko-subnav-count-dok')).toHaveText('4');
    await page.locator('#kontrolle-tabs [data-ko-tab="dokumente"]').click();
    const zeilen = page.locator('.dx-tabelle tbody tr');
    await expect(zeilen).toHaveCount(4);
    await expect(page.locator('#dx-anzahl')).toContainText('4 Dokumente');
    // Ordner: zwei Betriebe (Baum + Kacheln)
    await expect(page.locator('.dx-baum .dx-baum-zeile.is-betrieb')).toHaveText([/Hof Alpha\s*3/, /Hof Beta\s*1/]);
    await expect(page.locator('.dx-ordner-kachel')).toHaveCount(2);

    // in den Betrieb, dann in einen Termin
    await page.locator('.dx-ordner-kachel', { hasText: 'Hof Alpha' }).click();
    await expect(zeilen).toHaveCount(3);
    await expect(page.locator('.dx-pfad [aria-current="page"]')).toHaveText('Hof Alpha');
    await expect(page.locator('.dx-baum .dx-baum-zeile.is-termin')).toHaveCount(2);
    await page.locator('.dx-baum .dx-baum-zeile.is-termin', { hasText: 'Nachkontrolle' }).click();
    await expect(zeilen).toHaveCount(1);
    await expect(zeilen).toContainText('Verstoß Beleg');
    await expect(page.locator('#dx-datei')).toHaveCount(1); // im Termin-Ordner: Datei hinzufügen
    // zurück über den Pfad
    await page.locator('.dx-pfad [data-dx-ordner=""]').click();
    await expect(zeilen).toHaveCount(4);

    // Suche und Filter
    await page.locator('#dx-suche').fill('hit');
    await expect(zeilen).toHaveCount(1);
    await expect(page.locator('#dx-suche')).toBeFocused();
    await page.locator('#dx-suche').fill('');
    await page.locator('[data-dx-typ="foto"]').click();
    await expect(zeilen).toHaveCount(2);
    await page.locator('[data-dx-typ="alle"]').click();
    // Sortierung nach Name
    await page.locator('#dx-sort').selectOption('name');
    await expect(zeilen.first()).toContainText('2026_Hof Alpha_HIT-Auszug.pdf');
    await page.locator('#dx-sort').selectOption('gross');
    await expect(zeilen.first()).toContainText('HIT-Auszug');
    await expect(zeilen.first()).toContainText('1,2 MB');

    // Kacheln mit Vorschaubild (wird gemerkt)
    await page.locator('[data-dx-ansicht="kacheln"]').click();
    await expect(page.locator('.dx-kachel')).toHaveCount(4);
    await expect.poll(() => page.locator('.dx-kachel img[src]').count()).toBe(2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('feldfolio-dokumente-ansicht')))).toEqual({ ansicht: 'kacheln', sort: 'gross' });
  });

  test('Ansehen, umbenennen (neue Namensvorlagen), löschen, zum Termin, als ZIP', async ({ page, context }) => {
    await context.route('https://dv.test/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await start(page, { cloud: false });
    await page.evaluate(() => {
      window.__ffTestPhotoUrlOverride = async (p) => 'https://dv.test/' + encodeURIComponent(p);
      window.__geloescht = [];
    });
    await page.locator('#kontrolle-tabs [data-ko-tab="dokumente"]').click();
    const zeile = (text) => page.locator('.dx-tabelle tbody tr', { hasText: text });

    // ansehen: Viewer blättert durch die angezeigte Liste
    await zeile('Etikett').locator('[data-dx-akt="ansehen"]').click();
    await expect(page.locator('#docviewer')).toBeVisible();
    await expect(page.locator('#dv-meta')).toContainText('/ 4');
    await page.keyboard.press('Escape');

    // umbenennen: neue Vorlagen stehen zur Wahl
    await zeile('Etikett').locator('[data-dx-akt="umbenennen"]').click();
    const chips = page.locator('#docname-chips .docname-chip');
    for (const v of ['Lieferantenliste', 'Sortimentsliste', 'Wiederverkäuferliste', 'HIT-Auszug', 'FNN', 'Verstoß Beleg']) await expect(chips.filter({ hasText: new RegExp('^' + v + '$') })).toHaveCount(1);
    await chips.filter({ hasText: /^Sortimentsliste$/ }).click();
    await page.locator('#docname-save').click();
    await expect(zeile('2026_Hof Beta_Sortimentsliste.jpg')).toHaveCount(1);

    // zum Termin: Kontrollmappe, Reiter Dokumente; von dort zurück in den Explorer-Ordner
    await zeile('Sortimentsliste').locator('[data-dx-akt="termin"]').click();
    await expect(page.locator('#kontrollmappe')).toBeVisible();
    await expect(page.locator('#tk-attachments-grid')).toBeVisible();
    await page.locator('#tk-zum-explorer').click();
    await expect(page.locator('#kontrollmappe')).toBeHidden();
    await expect(page.locator('.dx-pfad [aria-current="page"]')).toContainText('Probenahme');
    await expect(page.locator('.dx-tabelle tbody tr')).toHaveCount(1);
    await page.locator('.dx-pfad [data-dx-ordner=""]').click();

    // als ZIP: Ordner Betrieb/Termin
    const [zip] = await Promise.all([page.waitForEvent('download'), page.locator('#dx-zip').click()]);
    expect(zip.suggestedFilename()).toBe('Dokumente.zip');
    const chunks = []; for await (const c of await zip.createReadStream()) chunks.push(c);
    const namen = await page.evaluate(async (b64) => Object.keys((await JSZip.loadAsync(b64, { base64: true })).files).filter(n => !n.endsWith('/')).sort(), Buffer.concat(chunks).toString('base64'));
    expect(namen).toHaveLength(4);
    expect(namen.some(n => /^Hof Beta\/.*Probenahme\/2026_Hof Beta_Sortimentsliste\.jpg$/.test(n))).toBe(true);
    expect(namen.filter(n => n.startsWith('Hof Alpha/'))).toHaveLength(3);
  });
});
