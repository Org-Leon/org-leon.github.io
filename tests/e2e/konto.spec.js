import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud, TEST_USER, gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// FeldFolio+ Konto: Anmelde-Fenster, Passwort vergessen/neu, Konto-Menü,
// Profil (inkl. Unterschrift in Protokollen), Sicherheit (Passwort ändern,
// überall abmelden, Konto löschen), Sync & Gerät (Sicherungen), Abmelden mit
// Wahl. Server-Aufrufe laufen über window.__ffTestAuth (supabase.js) bzw. den
// Cloud-Stub window.__ffTestCloud.

async function stubAuth(page, overrides = {}) {
  await page.evaluate((o) => {
    window.__authCalls = [];
    const log = (name, ...args) => window.__authCalls.push({ name, args });
    window.__ffTestAuth = {
      signIn: async (email, pw) => {
        log('signIn', email);
        if (pw !== 'richtig123') throw new Error('Invalid login credentials');
        return { session: { user: { id: 'test-user', email } } };
      },
      signUp: async (email) => { log('signUp', email); return { session: null }; },
      signOut: async () => { log('signOut'); },
      requestPasswordReset: async (email) => { log('reset', email); },
      updatePassword: async (pw) => { log('updatePassword', pw); },
      verifyPassword: async (email, pw) => { log('verify', email); if (pw !== 'richtig123') throw new Error('Invalid login credentials'); },
      signOutEverywhere: async () => { log('signOutEverywhere'); },
      deleteMyAccount: async () => { log('deleteMyAccount'); }
    };
    Object.assign(window.__ffTestAuth, o);
  }, overrides);
}
const calls = (page, name) => page.evaluate((n) => window.__authCalls.filter(c => c.name === n), name);

async function loggedIn(page, email = TEST_USER.email) {
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await stubAuth(page);
  await loginWithCloud(page, { ...TEST_USER, email });
}
async function openSettings(page, tab) {
  await page.locator('#btn-account').click();
  await page.locator('#account-menu-settings').click();
  if (tab) await page.locator(`#account-tabs [data-account-tab="${tab}"]`).click();
}

test.describe('Anmelde-Fenster', () => {
  test('Vorteile, Passwort anzeigen, Registrieren mit Wiederholung und Stärke, verständliche Fehler', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await stubAuth(page);
    await page.locator('#btn-account').click();
    const dlg = page.locator('#account-modal-overlay');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.account-benefits li')).toHaveCount(3);
    await expect(page.locator('#account-forgot')).toBeVisible();
    await expect(page.locator('#account-signup-extra')).toBeHidden();

    // Passwort anzeigen/verbergen
    await page.locator('#account-password').fill('geheim');
    await page.locator('[data-pw-toggle="account-password"]').click();
    await expect(page.locator('#account-password')).toHaveAttribute('type', 'text');
    await page.locator('[data-pw-toggle="account-password"]').click();
    await expect(page.locator('#account-password')).toHaveAttribute('type', 'password');

    // Falsches Passwort -> deutsche Meldung
    await page.locator('#account-email').fill('leon@oekop.de');
    await page.locator('#account-password').fill('falsch');
    await page.locator('#account-btn-submit').click();
    await expect(page.locator('#account-auth-error')).toHaveText('E-Mail oder Passwort stimmen nicht.');

    // Registrieren: Wiederholung + Stärke, Prüfungen vor dem Senden
    await page.locator('#account-mode-signup').click();
    await expect(page.locator('#account-signup-extra')).toBeVisible();
    await expect(page.locator('#account-forgot')).toBeHidden();
    await page.locator('#account-password').fill('kurz');
    await expect(page.locator('.account-strength-text')).toHaveText('Mindestens 8 Zeichen');
    await page.locator('#account-btn-submit').click();
    await expect(page.locator('#account-auth-error')).toContainText('mindestens 8 Zeichen');
    await page.locator('#account-password').fill('Lang-genug-123');
    await expect(page.locator('#account-strength')).toHaveAttribute('data-score', '4');
    await page.locator('#account-password2').fill('anders');
    await page.locator('#account-btn-submit').click();
    await expect(page.locator('#account-auth-error')).toHaveText('Die beiden Passwörter stimmen nicht überein.');
    await page.locator('#account-password2').fill('Lang-genug-123');
    await page.locator('#account-btn-submit').click();
    await expect(page.locator('#account-auth-error')).toContainText('bitte E-Mail bestätigen');
    expect(await calls(page, 'signUp')).toHaveLength(1);
  });

  test('Anmelden schließt das Fenster, danach öffnet das Konto-Symbol das Menü', async ({ page }) => {
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await stubAuth(page);
    await page.locator('#btn-account').click();
    await page.locator('#account-email').fill('leon@oekop.de');
    await page.locator('#account-password').fill('richtig123');
    await page.keyboard.press('Enter');
    await expect(page.locator('#account-modal-overlay')).toBeHidden();
    await expect(page.locator('#btn-account')).toHaveClass(/logged-in/);
    await page.locator('#btn-account').click();
    const menu = page.locator('#account-menu');
    await expect(menu).toBeVisible();
    await expect(page.locator('#account-menu-name')).toHaveText('leon@oekop.de');
    await expect(page.locator('#account-menu-admin')).toBeVisible(); // oekop.de = Admin
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('Passwort vergessen: Link anfordern, neues Passwort festlegen', async ({ page }) => {
    await page.goto('/');
    await stubAuth(page);
    await page.locator('#btn-account').click();
    await page.locator('#account-email').fill('leon@oekop.de');
    await page.locator('#account-forgot').click();
    await expect(page.locator('#account-forgot-block')).toBeVisible();
    await expect(page.locator('#account-forgot-email')).toHaveValue('leon@oekop.de');
    await page.locator('#account-forgot-send').click();
    await expect(page.locator('#account-forgot-status')).toContainText('der Link unterwegs');
    expect((await calls(page, 'reset'))[0].args[0]).toBe('leon@oekop.de');
    await page.locator('#account-forgot-back').click();
    await expect(page.locator('#account-auth-form')).toBeVisible();
    await page.locator('#account-modal-close-x').click();

    // Link aus der Mail geöffnet
    await page.evaluate(() => window.__ffTestKonto.startRecovery());
    await expect(page.locator('#account-recovery-block')).toBeVisible();
    await expect(page.locator('#account-auth-wrap')).toBeHidden();
    await page.locator('#account-recovery-password').fill('Neu-Passwort-1');
    await page.locator('#account-recovery-password2').fill('anders');
    await page.locator('#account-recovery-save').click();
    await expect(page.locator('#account-recovery-status')).toContainText('stimmen nicht überein');
    await page.locator('#account-recovery-password2').fill('Neu-Passwort-1');
    await page.locator('#account-recovery-save').click();
    await expect(page.locator('#account-modal-overlay')).toBeHidden();
    await expect(page.locator('#ff-toast')).toContainText('Neues Passwort gespeichert');
    expect((await calls(page, 'updatePassword'))[0].args[0]).toBe('Neu-Passwort-1');
  });
});

test.describe('Konto-Seite', () => {
  test('Profil mit Unterschrift: gespeichert, synchronisiert, in Protokollen verwendet', async ({ page }) => {
    await loggedIn(page);
    await openSettings(page);
    await expect(page.locator('#account-tabs [data-account-tab="profil"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#profil-name').fill('Leon Muster');
    await page.locator('#profil-telefon').fill('0170 123');
    // Unterschrift zeichnen (Pointer-Events direkt, siehe AGENTS.md Punkt 2)
    await page.locator('#profil-signatur-pad').evaluate((c) => {
      const r = c.getBoundingClientRect();
      const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 3, clientX: r.left + x, clientY: r.top + y, bubbles: true }));
      ev('pointerdown', 20, 40); ev('pointermove', 120, 70); ev('pointermove', 220, 30); ev('pointerup', 220, 30);
    });
    await page.locator('#profil-save').click();
    await expect(page.locator('#profil-status')).toContainText('Gespeichert');
    await expect(page.locator('#account-title')).toHaveText('Leon Muster');
    await expect(page.locator('#account-head-badge')).toHaveText('LM');
    const profil = await page.evaluate(() => window.__ffTestKonto.profil());
    expect(profil.name).toBe('Leon Muster');
    expect(profil.signatur).toMatch(/^data:image\/png/);
    // lokal gesichert und in die Cloud übertragen
    await expect.poll(() => page.evaluate(() => window.__ffTestOffline.record().full.profil?.name)).toBe('Leon Muster');
    await expect.poll(() => page.evaluate(() => window.__ffTestCloud.row?.data?.profil?.telefon)).toBe('0170 123');
    await page.locator('#account-modal-close-3').click();

    // Probenahmeprotokoll: Name vorbelegt, Unterschrift per Knopfdruck
    await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Hof Profil' }));
    await gotoKontrolleKalender(page);
    await openFirstTermin(page, 'protokolle');
    await page.locator('#tk-probenprotokoll-new').click();
    await expect(page.locator('[data-field="Probenehmer Name"]')).toHaveValue('Leon Muster');
    const own = page.locator('.pp-signature-own[data-sig-own="signatureProbenehmer"]');
    await expect(own).toBeVisible();
    await expect(page.locator('.pp-signature-own[data-sig-own="signatureBetriebsinhaber"]')).toHaveCount(0);
    await own.click();
    const sig = await page.evaluate(() => window.__ffTestProbenprotokoll.getActive().signatureProbenehmer);
    expect(sig).toBe(profil.signatur);
  });

  test('Passwort ändern prüft das aktuelle Passwort', async ({ page }) => {
    await loggedIn(page);
    await openSettings(page, 'sicherheit');
    await page.locator('#pw-current').fill('falsch');
    await page.locator('#pw-new').fill('Neu-Passwort-1');
    await page.locator('#pw-new2').fill('Neu-Passwort-1');
    await page.locator('#pw-change').click();
    await expect(page.locator('#pw-status')).toHaveText('Das aktuelle Passwort stimmt nicht.');
    expect(await calls(page, 'updatePassword')).toHaveLength(0);
    await page.locator('#pw-current').fill('richtig123');
    await page.locator('#pw-change').click();
    await expect(page.locator('#pw-status')).toHaveText('Passwort geändert.');
    expect((await calls(page, 'updatePassword'))[0].args[0]).toBe('Neu-Passwort-1');
    await expect(page.locator('#pw-current')).toHaveValue('');
  });

  test('Auf allen Geräten abmelden: abgemeldet, Daten auf diesem Gerät bleiben', async ({ page }) => {
    await loggedIn(page);
    await page.evaluate(() => window.__ffTestOffline.persist());
    await openSettings(page, 'sicherheit');
    page.once('dialog', d => d.accept());
    await page.locator('#account-signout-everywhere').click();
    await expect(page.locator('#btn-account')).not.toHaveClass(/logged-in/);
    expect(await calls(page, 'signOutEverywhere')).toHaveLength(1);
    expect(await page.evaluate((id) => window.__ffTestOffline.readStored(id), TEST_USER.id)).not.toBeNull();
  });

  test('Konto löschen: erst nach Passwort und „LÖSCHEN", danach abgemeldet und Gerät geleert', async ({ page }) => {
    await loggedIn(page);
    await page.evaluate(() => window.__ffTestOffline.persist());
    await openSettings(page, 'sicherheit');
    await page.locator('#account-delete-open').click();
    const confirmBtn = page.locator('#account-delete-confirm');
    await expect(confirmBtn).toBeDisabled();
    await page.locator('#delete-confirm').fill('löschen');
    await expect(confirmBtn).toBeEnabled();
    await page.locator('#delete-password').fill('falsch');
    await confirmBtn.click();
    await expect(page.locator('#delete-status')).toHaveText('Das Passwort stimmt nicht.');
    expect(await calls(page, 'deleteMyAccount')).toHaveLength(0);
    await page.locator('#delete-password').fill('richtig123');
    await confirmBtn.click();
    await expect(page.locator('#btn-account')).not.toHaveClass(/logged-in/);
    expect(await calls(page, 'deleteMyAccount')).toHaveLength(1);
    expect(await page.evaluate((id) => window.__ffTestOffline.readStored(id), TEST_USER.id)).toBeNull();
    await expect(page.locator('#ff-toast')).toContainText('Konto wurde gelöscht');
  });

  test('Sync & Gerät: Jetzt synchronisieren, Sicherung wiederherstellen', async ({ page }) => {
    await loggedIn(page);
    await page.evaluate(() => {
      window.__ffTestStallplaner.createPlan({ name: 'Alter Stall' });
    });
    await page.evaluate(() => window.__ffTestOffline.persist());
    await page.evaluate(() => window.__ffTestKonto.addBackup('Test-Sicherung'));
    // danach geändert
    await page.evaluate(() => { window.__ffTestStallplaner.getActivePlan().name = 'Neuer Name'; });
    await page.evaluate(() => window.__ffTestOffline.persist());

    await openSettings(page, 'sync');
    await page.locator('#account-sync-now').click();
    await expect(page.locator('#ff-toast')).toContainText('Synchronisiert');
    await expect(page.locator('#account-sync-title')).toHaveText('Gespeichert');
    const row = page.locator('.account-backup-row', { hasText: 'Test-Sicherung' });
    await expect(row).toBeVisible();
    page.once('dialog', d => d.accept());
    await row.locator('[data-restore-backup]').click();
    await expect(page.locator('#ff-toast')).toContainText('Sicherung wiederhergestellt');
    expect(await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().name)).toBe('Alter Stall');
    // Stand vor dem Wiederherstellen wurde selbst gesichert
    await expect(page.locator('.account-backup-row', { hasText: 'Stand vor dem Wiederherstellen' })).toBeVisible();
  });

  test('Abmelden: Wahl, ob die Daten auf dem Gerät bleiben', async ({ page }) => {
    await loggedIn(page);
    await page.evaluate(() => window.__ffTestOffline.persist());
    await page.locator('#btn-account').click();
    await page.locator('#account-menu-signout').click();
    await expect(page.locator('#signout-overlay')).toBeVisible();
    await expect(page.locator('#signout-wipe')).toBeChecked();
    await page.locator('#signout-wipe').uncheck();
    await page.locator('#signout-confirm').click();
    await expect(page.locator('#signout-overlay')).toBeHidden();
    await expect(page.locator('#btn-account')).not.toHaveClass(/logged-in/);
    expect(await page.evaluate((id) => window.__ffTestOffline.readStored(id), TEST_USER.id)).not.toBeNull();

    // erneut anmelden, diesmal mit Löschen
    await loginWithCloud(page);
    await page.evaluate(() => window.__ffTestOffline.persist());
    await page.locator('#btn-account').click();
    await page.locator('#account-menu-signout').click();
    await page.locator('#signout-confirm').click();
    await expect(page.locator('#btn-account')).not.toHaveClass(/logged-in/);
    expect(await page.evaluate((id) => window.__ffTestOffline.readStored(id), TEST_USER.id)).toBeNull();
  });
});

test.describe('Konto am Handy', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Anmelde-Fenster als Blatt von unten, Menü über volle Breite', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-account').tap();
    const box = await page.locator('#account-modal-overlay .account-card').boundingBox();
    expect(Math.round(box.width)).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(844);
    await page.locator('#account-modal-close-x').tap();
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page);
    await page.locator('#btn-account').tap();
    const menu = await page.locator('#account-menu').boundingBox();
    expect(menu.width).toBeGreaterThan(360);
  });
});
