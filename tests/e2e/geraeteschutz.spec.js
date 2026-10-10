import { test, expect } from '@playwright/test';
import { setupCloud, openFirstTermin } from './helpers.js';

// Geräteschutz: Offline-Daten verschlüsselt (Konto-Passwort), Sperrbildschirm
// beim Start und nach Inaktivität, Einstellungen unter Konto → Sicherheit.
// In den übrigen Tests ist er aus (navigator.webdriver, siehe main.js); hier
// per window.__ffTestGeraeteschutz eingeschaltet. Alle Daten frei erfunden.
const PW = 'richtig123';
const USER = { id: 'test-user', email: 'pruefer@example.org' };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.__ffTestGeraeteschutz = true; });
});

async function stubAuth(page) {
  await page.evaluate((pw) => {
    window.__pw = pw; // aktuelles Konto-Passwort "auf dem Server"
    window.__ffTestAuth = {
      signIn: async (email, p) => { if (p !== window.__pw) throw new Error('Invalid login credentials'); return { session: { user: { id: 'test-user', email } } }; },
      signOut: async () => {},
      verifyPassword: async (email, p) => { if (p !== window.__pw) throw new Error('Invalid login credentials'); },
      updatePassword: async (p) => { window.__pw = p; }
    };
  }, PW);
}
async function anmelden(page, pw = PW) {
  await page.locator('#btn-account').click();
  await page.locator('#account-email').fill(USER.email);
  await page.locator('#account-password').fill(pw);
  await page.locator('#account-btn-submit').click();
}
// Start abgeschlossen (nach dem Entsperren und dem Laden des Stands)
const starts = (page) => page.evaluate(() => window.__ffTestOffline.starts());
async function gestartet(page, mehrAls = 0) { await expect.poll(() => starts(page), { timeout: 10000 }).toBeGreaterThan(mehrAls); }
async function start(page) {
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await stubAuth(page);
  await anmelden(page);
  await expect(page.locator('#btn-account')).toHaveClass(/logged-in/);
  await gestartet(page);
  await expect(page.locator('#gs-overlay')).toBeHidden();
}
// Neustart der App nachstellen (Speicher und Schlüssel weg, Start mit gespeicherter Anmeldung) —
// nicht abwarten: der Start wartet auf das Entsperren
const neustart = (page) => page.evaluate((u) => { window.__ffTestOffline.clear(); window.__ffTestOffline.start(u); }, USER);
const stallName = (page) => page.evaluate(() => window.__ffTestStallplaner.getActivePlan()?.name || null);
async function stallAnlegen(page, name) {
  await page.evaluate((n) => window.__ffTestStallplaner.createPlan({ name: n }), name);
  await page.evaluate(() => window.__ffTestOffline.persist());
}
async function entsperren(page, pw = PW) {
  await page.locator('#gs-passwort').fill(pw);
  await page.locator('#gs-ok').click();
}
async function sicherheit(page) {
  await page.locator('#btn-account').click();
  await page.locator('#account-menu-settings').click();
  await page.locator('[data-account-tab="sicherheit"]').click();
}
// Rohinhalt der Offline-Datenbank als Text (Blobs als Text, Verschlüsseltes als [bytes])
const rohDaten = (page) => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('feldfolio-offline'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tiefe = async (v) => {
    if (v instanceof Blob) return v.text();
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return '[bytes]';
    if (Array.isArray(v)) return Promise.all(v.map(tiefe));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await tiefe(x); return o; }
    return v;
  };
  const out = {};
  for (const name of db.objectStoreNames) {
    const werte = await new Promise((res, rej) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    out[name] = await tiefe(werte);
  }
  db.close();
  return JSON.stringify(out);
});

test.describe('Geräteschutz', () => {
  test('Anmelden richtet ihn ein: Daten verschlüsselt, Neustart verlangt das Passwort', async ({ page }) => {
    await start(page);
    await stallAnlegen(page, 'Stall Geheimname');
    await page.evaluate(() => window.__ffTestKonto.addBackup('Testsicherung'));
    const roh = await rohDaten(page);
    expect(roh).not.toContain('Geheimname');          // weder im Stand noch in der Sicherung
    expect(roh).toContain('verschluesselt');

    await sicherheit(page);
    await expect(page.locator('#gs-aktiv')).toBeChecked();
    await expect(page.locator('#gs-status')).toContainText('Geschützt');
    await expect(page.locator('#gs-sperre')).toHaveValue('15');
    await page.keyboard.press('Escape');

    await neustart(page);
    await expect(page.locator('#gs-overlay')).toBeVisible();
    await expect(page.locator('#gs-titel')).toHaveText('FeldFolio ist gesperrt');
    await expect(page.locator('#gs-email')).toHaveText(USER.email);
    await expect(page.locator('#btn-account')).toBeHidden();       // der Rest der App ist ausgeblendet
    expect(await stallName(page)).toBeNull();                      // nichts geladen
    await entsperren(page, 'falsch');
    await expect(page.locator('#gs-fehler')).toHaveText('Das Passwort stimmt nicht.');
    await entsperren(page);
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await expect.poll(() => stallName(page)).toBe('Stall Geheimname');
    const sicherungen = await page.evaluate((id) => window.__ffTestOffline.backups(id), USER.id);
    expect(sicherungen.map(b => b.reason)).toContain('Testsicherung');
    expect(sicherungen.find(b => b.reason === 'Testsicherung').full).toBeTruthy(); // entschlüsselt lesbar
  });

  test('Start ohne Netz: Entsperren geht offline', async ({ page, context }) => {
    await start(page);
    await stallAnlegen(page, 'Stall Offline');
    await page.evaluate(() => window.__ffTestOffline.clear());
    await context.setOffline(true);
    await page.evaluate(() => { window.__ffTestOffline.boot(); });
    await expect(page.locator('#gs-overlay')).toBeVisible();
    await entsperren(page);
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await expect.poll(() => stallName(page)).toBe('Stall Offline');
    await context.setOffline(false);
  });

  test('Jetzt sperren; automatische Sperre nach Inaktivität (einstellbar)', async ({ page }) => {
    await page.clock.install();
    await start(page);
    await page.locator('#btn-account').click();
    await page.locator('#account-menu-sperren').click();
    await expect(page.locator('#gs-overlay')).toBeVisible();
    await entsperren(page);
    await expect(page.locator('#gs-overlay')).toBeHidden();

    // Standard: 15 Minuten ohne Bedienung
    await page.clock.fastForward('10:00');
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await page.clock.fastForward('06:00');
    await expect(page.locator('#gs-overlay')).toBeVisible();
    await entsperren(page);
    await expect(page.locator('#gs-overlay')).toBeHidden();

    // "Nur beim Öffnen der App": keine Sperre nach Inaktivität
    await sicherheit(page);
    await page.locator('#gs-sperre').selectOption('0');
    await expect(page.locator('#gs-meldung')).toHaveText('Gespeichert.');
    await page.keyboard.press('Escape');
    await page.clock.fastForward('02:00:00');
    await expect(page.locator('#gs-overlay')).toBeHidden();
  });

  test('Ausschalten und wieder einschalten — jeweils mit Passwort', async ({ page }) => {
    await start(page);
    await stallAnlegen(page, 'Stall Schalter');
    await sicherheit(page);
    await page.locator('#gs-aktiv').uncheck();
    await expect(page.locator('#gs-bestaetigen')).toBeVisible();
    await page.locator('#gs-bestaetigen-pw').fill('falsch');
    await page.locator('#gs-bestaetigen-ok').click();
    await expect(page.locator('#gs-meldung')).toHaveText('Das Passwort stimmt nicht.');
    await page.locator('#gs-bestaetigen-pw').fill(PW);
    await page.locator('#gs-bestaetigen-ok').click();
    await expect(page.locator('#gs-meldung')).toHaveText('Geräteschutz ausgeschaltet.');
    await expect(page.locator('#gs-status')).toContainText('Nicht geschützt');
    await expect(page.locator('#gs-optionen')).toBeHidden();
    expect(await rohDaten(page)).toContain('Stall Schalter'); // wieder unverschlüsselt
    await page.keyboard.press('Escape');
    await neustart(page);
    await expect.poll(() => stallName(page)).toBe('Stall Schalter');
    await expect(page.locator('#gs-overlay')).toBeHidden();      // ohne Sperre

    await sicherheit(page);
    await page.locator('#gs-aktiv').check();
    await page.locator('#gs-bestaetigen-pw').fill(PW);
    await page.locator('#gs-bestaetigen-ok').click();
    await expect(page.locator('#gs-meldung')).toHaveText('Geräteschutz eingeschaltet.');
    await expect(page.locator('#gs-aktiv')).toBeChecked();
    expect(await rohDaten(page)).not.toContain('Stall Schalter');
  });

  test('Schon angemeldet, noch nicht eingerichtet: einmal fragen („Ohne Schutz weiter“ möglich)', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await stubAuth(page);
    await page.evaluate((u) => { window.__ffTestTk.loginFake(u.email); window.__ffTestOffline.start(u); }, USER);
    await expect(page.locator('#gs-overlay')).toBeVisible();
    await expect(page.locator('#gs-titel')).toHaveText('Daten auf diesem Gerät schützen');
    await expect(page.locator('#gs-abmelden')).toBeHidden();
    await page.locator('#gs-ohne').click();
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await gestartet(page);
    await neustart(page);
    await expect(page.locator('#gs-overlay')).toBeHidden(); // Entscheidung gilt
    // Einrichten mit Passwort (online geprüft)
    await page.evaluate(() => window.__ffTestOffline.clear());
    await page.evaluate(() => indexedDB.deleteDatabase('feldfolio-offline'));
    await page.reload();
    await setupCloud(page, { workspaces: {} });
    await stubAuth(page);
    await page.evaluate((u) => { window.__ffTestTk.loginFake(u.email); window.__ffTestOffline.start(u); }, USER);
    await expect(page.locator('#gs-titel')).toHaveText('Daten auf diesem Gerät schützen');
    await entsperren(page, 'falsch');
    await expect(page.locator('#gs-fehler')).toHaveText('Das Passwort stimmt nicht.');
    await entsperren(page);
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await gestartet(page);
    await stallAnlegen(page, 'Stall Eingerichtet');
    expect(await rohDaten(page)).not.toContain('Stall Eingerichtet');
  });

  test('Passwort anderswo geändert: einmal das alte, danach gilt das neue', async ({ page }) => {
    await start(page);
    await stallAnlegen(page, 'Stall Wechsel');
    await page.locator('#btn-account').click();
    await page.locator('#account-menu-signout').click();
    await page.locator('#signout-wipe').uncheck();
    await page.locator('#signout-confirm').click();
    await expect(page.locator('#btn-account')).not.toHaveClass(/logged-in/);

    await page.evaluate(() => { window.__pw = 'neues-pw-45678'; });
    const vorher = await starts(page);
    await anmelden(page, 'neues-pw-45678');
    await expect(page.locator('#gs-overlay')).toBeVisible();
    await expect(page.locator('#gs-titel')).toHaveText('Passwort wurde geändert');
    await entsperren(page, 'neues-pw-45678');
    await expect(page.locator('#gs-fehler')).toHaveText('Das Passwort stimmt nicht.');
    await entsperren(page, PW);
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await gestartet(page, vorher);
    await expect.poll(() => stallName(page)).toBe('Stall Wechsel');

    await neustart(page);
    await entsperren(page, PW);
    await expect(page.locator('#gs-fehler')).toHaveText('Das Passwort stimmt nicht.');
    await entsperren(page, 'neues-pw-45678');
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await expect.poll(() => stallName(page)).toBe('Stall Wechsel');
  });

  test('Passwort in den Einstellungen geändert: Daten danach mit dem neuen Passwort', async ({ page }) => {
    await start(page);
    await stallAnlegen(page, 'Stall Neu');
    await sicherheit(page);
    await page.locator('#pw-current').fill(PW);
    await page.locator('#pw-new').fill('anderes-pw-123');
    await page.locator('#pw-new2').fill('anderes-pw-123');
    await page.locator('#pw-change').click();
    await expect(page.locator('#pw-status')).toHaveText('Passwort geändert.');
    await page.keyboard.press('Escape');
    await neustart(page);
    await entsperren(page, 'anderes-pw-123');
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await expect.poll(() => stallName(page)).toBe('Stall Neu');
  });

  test('Passwort vergessen: Daten auf dem Gerät löschen, weiter mit dem Cloud-Stand', async ({ page }) => {
    await start(page);
    await stallAnlegen(page, 'Stall Abgeglichen');
    await page.evaluate(() => window.__ffTestOffline.sync());
    await page.evaluate(() => { window.__ffTestStallplaner.getActivePlan().name = 'Nur lokal geändert'; });
    await page.evaluate(() => window.__ffTestOffline.persist());
    await neustart(page);
    await expect(page.locator('#gs-overlay')).toBeVisible();
    await page.locator('#gs-vergessen summary').click();
    page.once('dialog', d => d.accept());
    await page.locator('#gs-verwerfen').click();
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await expect.poll(() => stallName(page)).toBe('Stall Abgeglichen'); // aus der Cloud
    expect(await rohDaten(page)).not.toContain('__tresor__');
  });

  test('Abmelden mit Löschen entfernt auch den Geräteschutz', async ({ page }) => {
    await start(page);
    await stallAnlegen(page, 'Stall Weg');
    expect((await page.evaluate(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('feldfolio-offline'); q.onsuccess = () => r(q.result); });
      return new Promise(r => { const q = db.transaction('state').objectStore('state').getAllKeys(); q.onsuccess = () => { db.close(); r(q.result); }; });
    }))).toContain('__tresor__:test-user');
    await page.locator('#btn-account').click();
    await page.locator('#account-menu-signout').click();
    await page.locator('#signout-confirm').click(); // "Daten löschen" ist vorausgewählt
    await expect(page.locator('#btn-account')).not.toHaveClass(/logged-in/);
    const roh = await rohDaten(page);
    expect(roh).not.toContain('__tresor__');
    expect(roh).not.toContain('verschluesselt');
  });

  test('Geöffnete Dokumente liegen verschlüsselt im Zwischenspeicher und öffnen auch offline', async ({ page, context }) => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await context.route('https://dv.test/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await start(page);
    await page.evaluate(() => {
      window.__ffTestPhotoUrlOverride = async (p) => 'https://dv.test/' + encodeURIComponent(p);
      window.__ffTestTk.addEvent({ kunde: 'Hof Dok', date: new Date(), attachments: [{ path: 'd/etikett.png', name: 'Etikett.png', type: 'image/png', size: 70, addedAt: new Date().toISOString() }] });
    });
    await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
    await page.locator('#kontrolle-tabs [data-ko-tab="uebersicht"]').click();
    const zeile = page.locator('[data-w-id="dokumente"] .ko-w-zeile', { hasText: 'Etikett' });
    await zeile.click();
    await expect(page.locator('#dv-content img')).toBeVisible();
    const imCache = () => page.evaluate(async () => {
      const c = await caches.open('feldfolio-dokumente-v1');
      const keys = await c.keys();
      if (!keys.length) return null;
      const r = await c.match(keys[0]);
      const b = new Uint8Array(await r.arrayBuffer());
      return { iv: !!r.headers.get('X-FF-IV'), png: String.fromCharCode(b[1], b[2], b[3]) === 'PNG' };
    });
    await expect.poll(imCache).toEqual({ iv: true, png: false }); // verschlüsselt, nicht als PNG lesbar
    await page.keyboard.press('Escape');
    await context.setOffline(true);
    await zeile.click();
    await expect(page.locator('#dv-content img')).toBeVisible();   // aus dem Zwischenspeicher entschlüsselt
    await page.keyboard.press('Escape');
    await context.setOffline(false);
  });

  test('Wartende Uploads liegen verschlüsselt; nach dem Neustart wird trotzdem hochgeladen', async ({ page, context }) => {
    await start(page);
    // nach dem Anmelden ist das Dashboard schon offen
    await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
    await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Hof Tresor' }));
    await openFirstTermin(page, 'dokumente');
    await page.evaluate(() => { window.__hoch = []; window.__ffTestUploadPhotoOverride = async (f) => { window.__hoch.push(await f.text()); return 'test/' + f.name; }; });
    await context.setOffline(true);
    await page.setInputFiles('#tk-photo-capture-input', { name: 'beleg.png', mimeType: 'image/png', buffer: Buffer.from('GEHEIMER-BELEGINHALT') });
    await expect.poll(() => page.evaluate(() => window.__ffTestUploads.stored().then(l => l.length))).toBe(1);
    const roh = await rohDaten(page);
    expect(roh).not.toContain('GEHEIMER-BELEGINHALT');
    expect(roh).not.toContain('beleg.png');
    // Neustart der Warteschlange: aus dem verschlüsselten Speicher wieder aufnehmen und hochladen
    await page.evaluate(() => window.__ffTestUploads.clearMemory());
    await page.evaluate(() => window.__ffTestUploads.resume());
    await context.setOffline(false);
    await expect.poll(() => page.evaluate(() => window.__hoch)).toEqual(['GEHEIMER-BELEGINHALT']);
  });

  test('Fingerabdruck/Gesicht (WebAuthn mit PRF) einrichten und damit entsperren', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true
    } });
    await start(page);
    await sicherheit(page);
    await page.locator('#gs-bio-an').click();
    await expect(page.locator('#gs-meldung')).toContainText('Eingerichtet');
    await expect(page.locator('#gs-bio-aus')).toBeVisible();
    await expect(page.locator('#gs-status')).toContainText('Fingerabdruck/Gesicht');
    await page.keyboard.press('Escape');
    await stallAnlegen(page, 'Stall Bio');
    await neustart(page);
    await expect(page.locator('#gs-bio')).toBeVisible();
    await page.locator('#gs-bio').click();
    await expect(page.locator('#gs-overlay')).toBeHidden();
    await expect.poll(() => stallName(page)).toBe('Stall Bio');
  });
});
