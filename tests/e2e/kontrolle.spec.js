import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Funktion "Kontrolle" (früher Terminkalender): Unterfunktionen Übersicht
// und Kalender, Kontrollmappe je Termin mit Reitern. Ein Termin bündelt alle
// Aufträge desselben Betriebs zur selben Zeit (Verbände, Probenahme, CC …).

// Termine relativ zu heute anlegen (Tage-Offset, Uhrzeit oder null = ganztägig).
async function seed(page, list) {
  return page.evaluate((items) => items.map(([dayOffset, hour, o]) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour == null ? 0 : hour, 0, 0, 0);
    return window.__ffTestTk.addEvent({ date: d, hasTime: hour != null, ...o });
  }), list);
}
async function login(page) {
  await page.goto('/');
  await page.evaluate(() => window.__ffTestTk.loginFake());
}
const openKontrolle = (page) => page.locator('#kontrolle-switcher').click();

test.describe('Kontrolle', () => {
  test('Ohne Anmeldung: Hinweis mit Anmelden-Button (auch per ?view=kontrolle)', async ({ page }) => {
    await page.goto('/?view=kontrolle');
    await expect(page.locator('#kontrolle-view')).toBeVisible();
    await expect(page.locator('#terminkalender-login-gate')).toBeVisible();
    await expect(page.locator('#kontrolle-main')).toBeHidden();
    await page.locator('#kontrolle-btn-login').click();
    await expect(page.locator('#account-modal-overlay')).toBeVisible();
  });

  test('Kachel heißt „Dashboard", Start in der Übersicht; alter Link ?view=terminkalender öffnet den Kalender', async ({ page }) => {
    await login(page);
    await expect(page.locator('#kontrolle-switcher')).toContainText('Dashboard');
    await openKontrolle(page);
    await expect(page.locator('#current-view-title')).toHaveText('Dashboard');
    await expect(page.locator('#ko-header-title')).toHaveText('Dashboard');
    await expect(page.locator('#kontrolle-tabs [role="tab"] .ko-tab-text')).toHaveText(['Übersicht', 'Kalender', 'Dokumente']);
    await expect(page.locator('#kontrolle-subnav .ko-subnav-label')).toHaveText(['Übersicht', 'Kalender', 'Dokumente']);
    await expect(page.locator('#kontrolle-uebersicht')).toBeVisible();
    await expect(page.locator('#terminkalender-main')).toBeHidden();
    await expect(page.locator('#map-wrap')).toBeHidden();

    await page.goto('/?view=terminkalender');
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await page.evaluate(() => document.querySelector('.segment-btn[data-view="viewer"]').click());
    await openKontrolle(page);
    await expect(page.locator('#terminkalender-main')).toBeVisible();
  });

  test('Ohne Termine: Übersicht bietet den Import an', async ({ page }) => {
    await login(page);
    await openKontrolle(page);
    await expect(page.locator('#ko-agenda .ko-empty')).toContainText('Noch keine Termine');
    await expect(page.locator('#ko-btn-import')).toBeVisible();
  });

  test('Übersicht: Kennzahlen und Heute & nächste Tage — keine „Offen"-Liste mehr', async ({ page }) => {
    await login(page);
    await seed(page, [
      [0, 9, { kunde: 'Hof Heute', bestaetigt: true, telefon: '0361 1', address: 'Hauptstr. 1, Erfurt' }],
      [1, null, { kunde: 'Hof Morgen', bestaetigt: false }],
      [20, 10, { kunde: 'Hof Später', bestaetigt: true }],
      [-3, 10, { kunde: 'Hof Vorbei', bestaetigt: true }]
    ]);
    await openKontrolle(page);

    await expect(page.locator('#ko-kpis .ko-kpi')).toHaveCount(3);
    await expect(page.locator('#ko-kpis')).toContainText('Termine heute');
    await expect(page.locator('#ko-kpis')).toContainText('Termine diese Woche');
    await expect(page.locator('#ko-kpis')).toContainText('Aufträge diese Woche');
    await expect(page.locator('#ko-kpis')).not.toContainText('Unbestätigt');
    await expect(page.locator('#ko-kpis')).not.toContainText('Protokolle offen');
    await expect(page.locator('#ko-kpis .ko-kpi-value').first()).toHaveText('1'); // heute
    await expect(page.locator('#ko-offen')).toHaveCount(0);
    await expect(page.locator('#ko-subnav-count-offen')).toHaveCount(0);

    // Agenda: nur heute bis +7 Tage, "Heute"/"Morgen" als Tagesüberschrift
    const agenda = page.locator('#ko-agenda');
    await expect(agenda.locator('.ko-agenda-row')).toHaveCount(2);
    await expect(agenda.locator('.ko-day-label').first()).toContainText('Heute');
    await expect(agenda.locator('.ko-day-label').nth(1)).toContainText('Morgen');
    await expect(agenda).not.toContainText('Hof Später');
    await expect(agenda).not.toContainText('Hof Vorbei');
    const heute = agenda.locator('.ko-agenda-row', { hasText: 'Hof Heute' });
    await expect(heute.locator('.ko-agenda-time')).toHaveText('09:00');
    await expect(heute.locator('a[href^="tel:"]')).toHaveCount(1);
    await expect(heute.locator('a[href*="google"]')).toHaveCount(1);
    await expect(agenda.locator('.ko-agenda-row', { hasText: 'Hof Morgen' }).locator('.ko-agenda-time')).toHaveText('ganztägig');

    // Termin antippen öffnet die Kontrollmappe.
    await heute.locator('.ko-agenda-main').click();
    await expect(page.locator('#kontrollmappe h3')).toHaveText('Hof Heute');
  });

  test('Aufträge zur selben Zeit beim selben Betrieb werden ein Termin, Verbände als farbige Schilder', async ({ page }) => {
    await login(page);
    const base = { kunde: 'Obsthof Huber GbR', bestaetigt: true };
    const ids = await seed(page, [
      [0, 9, { ...base, id: 'AO-1001', auditart: 'Öko-Kontrolle' }],
      [0, 9, { ...base, id: 'AO-1002', auditart: 'Demeter-Kontrolle' }],
      [0, 9, { ...base, id: 'AO-1003', auditart: 'Verbandskontrolle', dienstleistungen: 'Bioland' }],
      [0, 9, { ...base, id: 'AO-1004', auditart: 'Probenahme', bestaetigt: false }],
      [0, 9, { ...base, id: 'AO-1005', auditart: 'CC-Anfrage' }],
      // gleicher Betrieb, andere Uhrzeit -> eigener Termin
      [0, 15, { ...base, id: 'AO-1006', auditart: 'Nachkontrolle' }],
      // anderer Betrieb, gleiche Zeit -> eigener Termin
      [0, 9, { kunde: 'Biohof Sonnental', id: 'AO-2001', auditart: 'Naturland Kontrolle', bestaetigt: true }]
    ]);

    // Übersicht: 3 Termine heute, 7 Aufträge
    await openKontrolle(page);
    await expect(page.locator('#ko-kpis .ko-kpi-value').first()).toHaveText('3');
    await expect(page.locator('#ko-kpis .ko-kpi-value').nth(2)).toHaveText('7');
    const huberRow = page.locator('#ko-agenda .ko-agenda-row', { hasText: 'Obsthof Huber GbR' }).first();
    await expect(huberRow.locator('.tk-auftrag-count')).toHaveText('5 Aufträge');

    // Kalender: eine Karte für die 5 Aufträge um 9 Uhr
    await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
    await expect(page.locator('.tk-card')).toHaveCount(3);
    const card = page.locator('.tk-card', { hasText: '09:00' }).filter({ hasText: 'Obsthof Huber GbR' });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/tk-card-multi/);
    await expect(card.locator('.tk-auftrag-count')).toHaveText('5 Aufträge');
    // Verbände farbig, Sonderarten neutral mit Symbol (max. 4 + Rest)
    await expect(card.locator('.tk-chip-verband[data-verband="demeter"]')).toHaveText('Demeter');
    await expect(card.locator('.tk-chip-verband[data-verband="bioland"]')).toHaveText('Bioland');
    await expect(card.locator('.tk-chip-art[data-art="probe"]')).toContainText('Probenahme');
    await expect(card.locator('.tk-chip-art[data-art="cc"]')).toContainText('CC-Anfrage');
    const demeterBg = await card.locator('[data-verband="demeter"]').evaluate(el => getComputedStyle(el).backgroundColor);
    const biolandBg = await card.locator('[data-verband="bioland"]').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(demeterBg).not.toBe(biolandBg);
    await expect(page.locator('.tk-card', { hasText: 'Biohof Sonnental' }).locator('[data-verband="naturland"]')).toHaveCount(1);
    await expect(page.locator('.tk-card', { hasText: '15:00' }).locator('.tk-auftrag-count')).toHaveCount(0);

    // Kontrollmappe: alle Aufträge mit AO-Nummer und Status
    await card.click();
    const mappe = page.locator('#kontrollmappe');
    await expect(mappe.locator('.km-auftrag')).toHaveCount(5);
    await expect(mappe.locator('.km-section h4').first()).toHaveText('Aufträge (5)');
    await expect(mappe.locator('.km-auftrag', { hasText: 'AO-1002' })).toContainText('Demeter-Kontrolle');
    await expect(mappe.locator('.km-auftrag', { hasText: 'AO-1004' })).toContainText('Unbestätigt');
    await expect(mappe.locator('.tk-badges')).toContainText('Unbestätigt'); // Termin gesamt
    await expect(mappe.locator('.km-title .tk-chip')).toHaveCount(4);

    // Verschieben verschiebt alle Aufträge des Termins gemeinsam.
    const target = await page.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() + 9);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await page.locator('#tk-move-date').fill(target);
    const moved = await page.evaluate((list) => list.map(id => {
      const d = window.__ffTestTk.getEvent(id).date;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.getHours()}`;
    }), ids.slice(0, 6));
    expect(moved.slice(0, 5)).toEqual(Array(5).fill(`${target} 9`));
    expect(moved[5].endsWith(' 15')).toBe(true);
    expect(moved[5].startsWith(target)).toBe(false);
  });

  test('Unterlagen einzelner Aufträge landen gesammelt beim Termin', async ({ page }) => {
    await login(page);
    const [a, b] = await seed(page, [
      [0, 9, { kunde: 'Hof Bündel', id: 'AO-7001', auditart: 'Öko-Kontrolle' }],
      [0, 9, { kunde: 'Hof Bündel', id: 'AO-7002', auditart: 'Bioland', attachments: [{ path: 'x/a.pdf', name: 'a.pdf', type: 'application/pdf', size: 1 }], notiz: 'Alte Notiz' }]
    ]);
    await gotoKontrolleKalender(page);
    await openFirstTermin(page, 'dokumente');
    await expect(page.locator('#kontrollmappe [data-km-tab="dokumente"] .km-tab-count')).toHaveText('1');
    const state = await page.evaluate(([x, y]) => {
      const ea = window.__ffTestTk.getEvent(x), eb = window.__ffTestTk.getEvent(y);
      return { a: ea.attachments.length + (ea.notiz ? 1 : 0), b: eb.attachments.length + (eb.notiz ? 1 : 0) };
    }, [a, b]);
    // alles an genau einem Auftrag, nichts verloren
    expect(state.a + state.b).toBe(2);
    expect(Math.min(state.a, state.b)).toBe(0);
    await page.locator('#kontrollmappe [data-km-tab="notizen"]').click();
    await expect(page.locator('#tk-notiz')).toHaveValue('Alte Notiz');
  });

  test('Reiter wechseln über Kopf, Seitenleiste und „Zum Kalender"', async ({ page }) => {
    await login(page);
    await openKontrolle(page);
    await page.locator('#kontrolle-uebersicht .ko-link-btn[data-ko-tab="kalender"]').click();
    await expect(page.locator('#terminkalender-main')).toBeVisible();
    await expect(page.locator('#kontrolle-tabs [data-ko-tab="kalender"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#kontrolle-subnav [data-ko-tab="kalender"]')).toHaveClass(/active/);
    await page.locator('#kontrolle-subnav [data-ko-tab="uebersicht"]').click();
    await expect(page.locator('#kontrolle-uebersicht')).toBeVisible();
    // Beim erneuten Öffnen der Funktion bleibt der zuletzt gewählte Reiter.
    await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
    await page.locator('.segment-btn[data-view="viewer"]').click();
    await openKontrolle(page);
    await expect(page.locator('#terminkalender-main')).toBeVisible();
  });

  test('Kalender: Karten mit Uhrzeit, heutiger Tag markiert, Woche/Liste und Karte merken sich die Wahl', async ({ page }) => {
    await login(page);
    await seed(page, [[0, 14, { kunde: 'Hof Karte', auditart: 'Öko-Kontrolle', bestaetigt: true }]]);
    await gotoKontrolleKalender(page);
    const card = page.locator('.tk-card', { hasText: 'Hof Karte' });
    await expect(card.locator('.tk-card-time')).toContainText('14:00');
    await expect(card).toHaveClass(/tk-card-ok/);
    await expect(page.locator('.tk-day-col.is-today')).toHaveCount(1);
    await expect(page.locator('.tk-day-col.is-today')).toContainText('Hof Karte');

    await page.locator('#tk-mode [data-mode="liste"]').click();
    await expect(page.locator('#terminkalender-grid')).toHaveClass(/tk-list/);
    await expect(page.locator('#terminkalender-side')).toBeHidden();
    await page.locator('#tk-map-toggle').click();
    await expect(page.locator('#terminkalender-side')).toBeVisible();
    await expect(page.locator('#terminkalender-map .leaflet-tile-pane')).toHaveCount(1);

    await page.reload();
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await gotoKontrolleKalender(page);
    await expect(page.locator('#terminkalender-grid')).toHaveClass(/tk-list/);
    await expect(page.locator('#terminkalender-side')).toBeVisible();
  });

  test('Kontrollmappe: Kopf, Reiter mit Zählern, Notizen, schließen per X/Esc/Klick daneben', async ({ page }) => {
    await login(page);
    const [id] = await seed(page, [[0, 10, { kunde: 'Hof Mappe', auditart: 'Öko-Kontrolle', bestaetigt: false, unangemeldet: true, telefon: '0361 2' }]]);
    await gotoKontrolleKalender(page);
    await page.locator('.tk-card', { hasText: 'Hof Mappe' }).click();
    const mappe = page.locator('#kontrollmappe');
    await expect(mappe).toBeVisible();
    await expect(mappe.locator('h3')).toHaveText('Hof Mappe');
    await expect(mappe.locator('.tk-badges')).toContainText('Unbestätigt');
    await expect(mappe.locator('.tk-badges')).toContainText('Unangemeldet');
    await expect(mappe.locator('.km-actions a[href^="tel:"]')).toContainText('Anrufen');
    await expect(page.locator('#tk-betrieb-assign-btn')).toBeVisible();
    await expect(page.locator('.tk-card', { hasText: 'Hof Mappe' })).toHaveClass(/selected/);
    // Überblick ist Standard, Verschieben liegt dort.
    await expect(page.locator('#tk-move-date')).toBeVisible();
    await expect(page.locator('#tk-probenprotokoll-new')).toBeHidden();

    // Notizen
    await mappe.locator('[data-km-tab="notizen"]').click();
    await page.locator('#tk-notiz').fill('Hoftor hinten nutzen');
    await page.locator('#tk-notiz').blur();
    expect(await page.evaluate((evId) => window.__ffTestTk.getEvent(evId).notiz, id)).toBe('Hoftor hinten nutzen');

    // Esc schließt, Auswahl weg
    await page.keyboard.press('Escape');
    await expect(mappe).toBeHidden();
    await expect(page.locator('.tk-card.selected')).toHaveCount(0);
    // Klick daneben schließt
    await page.locator('.tk-card', { hasText: 'Hof Mappe' }).click();
    // Notiz ist beim erneuten Öffnen da, Notizen-Reiter zeigt einen Punkt.
    await expect(mappe.locator('[data-km-tab="notizen"] .km-tab-count')).toHaveCount(1);
    await page.locator('#kontrollmappe-backdrop').click({ position: { x: 20, y: 300 } });
    await expect(mappe).toBeHidden();
    // X schließt
    await page.locator('.tk-card', { hasText: 'Hof Mappe' }).click();
    await page.locator('#kontrollmappe-close').click();
    await expect(mappe).toBeHidden();
    // Funktionswechsel schließt die Mappe ebenfalls.
    await page.locator('.tk-card', { hasText: 'Hof Mappe' }).click();
    await page.locator('.segment-btn[data-view="viewer"]').click();
    await openKontrolle(page);
    await expect(mappe).toBeHidden();
  });
});

test.describe('Kontrolle am Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Kontrollmappe als Vollbild, Kalender immer als Liste', async ({ page }) => {
    await login(page);
    await seed(page, [[0, 9, { kunde: 'Hof Handy', bestaetigt: true }]]);
    await page.locator('#btn-sidebar-toggle').click();
    await page.locator('#kontrolle-switcher').click();
    // Übersicht: Termin antippen öffnet die Mappe über den ganzen Bildschirm.
    await page.locator('#ko-agenda .ko-agenda-main').first().tap();
    const box = await page.locator('#kontrollmappe').boundingBox();
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.y)).toBe(0);
    expect(Math.round(box.width)).toBe(390);
    expect(Math.round(box.height)).toBe(844);
    await page.locator('#kontrollmappe-close').tap();
    await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').tap();
    await expect(page.locator('#tk-mode')).toBeHidden();
    const cols = await page.locator('.tk-day-col').evaluateAll(els => els.map(e => e.getBoundingClientRect().width));
    cols.forEach(w => expect(w).toBeGreaterThan(300));
  });
});

// Terminliste aus dem externen Programm (Excel): Titelzeile, Kopfzeile, je Termin
// eine Zeile. "Audit unangemeldet" ist dort ein Wahrheitswert (WAHR/FALSCH).
test('Terminimport (Excel): "Audit unangemeldet" als WAHR/FALSCH, "1" oder "Ja" erkannt', async ({ page }) => {
  await page.route('https://nominatim.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.evaluate(() => window.__ffTestTk.loginFake());
  await gotoKontrolleKalender(page);
  const tag = await page.evaluate(() => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; });
  const b64 = await page.evaluate((tag) => {
    const aoa = [['Termine'], ['Kunde', 'Auditdatum (von)', 'Audit unangemeldet'],
      ['Hof Wahr', tag, true], ['Hof Falsch', tag, false], ['Hof Eins', tag, '1'], ['Hof Ja', tag, 'Ja'], ['Hof Leer', tag, '']];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Termine');
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  }, tag);
  await page.setInputFiles('#terminkalender-file-input', { name: 'Termine.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b64, 'base64') });
  await expect(page.locator('.tk-card')).toHaveCount(5);
  // unangemeldet = Karte hervorgehoben, in der Kontrollmappe das Abzeichen "Unangemeldet"
  const karte = (name) => page.locator('.tk-card', { hasText: name });
  for (const name of ['Hof Wahr', 'Hof Eins', 'Hof Ja']) await expect(karte(name)).toHaveClass(/tk-card-urgent/);
  for (const name of ['Hof Falsch', 'Hof Leer']) await expect(karte(name)).not.toHaveClass(/tk-card-urgent/);
  await karte('Hof Wahr').click();
  await expect(page.locator('#kontrollmappe .tk-badges')).toContainText('Unangemeldet');
});
