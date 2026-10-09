import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud, TEST_USER } from './helpers.js';

// Verwaltung nur mit zweitem Faktor (supabase/admins.sql): Konten auf der Admin-
// Liste sehen den Reiter "Verwaltung", die Listen aber erst nach dem Code aus der
// Authenticator-App. Für alles andere reicht das Passwort.
// Server per window.__ffTestAdmin (auf der Liste) und window.__ffTestMfa
// (Authenticator eingerichtet / freigeschaltet / gültiger Code) gestubbt.
async function start(page, mfa) {
  await page.addInitScript((m) => { window.__ffTestAdmin = true; window.__ffTestMfa = m; }, mfa);
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await loginWithCloud(page, { ...TEST_USER, email: 'admin@oekop.de' });
}
async function verwaltung(page) {
  await page.locator('#btn-account').click();
  await page.locator('#account-menu-admin').click();
  await expect(page.locator('#account-tab-admin')).toHaveAttribute('aria-selected', 'true');
}
const gate = (page) => page.locator('#admin-2fa');
const listen = (page) => page.locator('#account-admin-requests');

test.describe('Verwaltung mit Zwei-Faktor', () => {
  test('Erstes Mal: Authenticator einrichten (QR-Code, Schlüssel), dann freigeschaltet', async ({ page }) => {
    await start(page, { eingerichtet: false, freigeschaltet: false, code: '654321' });
    // normale Nutzung ohne Code: Dashboard ist da
    await expect(page.locator('#btn-account')).toHaveClass(/logged-in/);
    await verwaltung(page);
    await expect(gate(page)).toBeVisible();
    await expect(listen(page)).toBeHidden();
    await expect(page.locator('#admin-2fa-titel')).toHaveText('Zwei-Faktor für die Verwaltung einrichten');
    await expect(page.locator('#admin-2fa-code')).toBeHidden();
    await page.locator('#admin-2fa-start').click();
    await expect(page.locator('#admin-2fa-qr')).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expect(page.locator('#admin-2fa-secret')).toHaveText('JBSW Y3DP EHPK 3PXP');
    await expect(page.locator('#admin-2fa-ok')).toHaveText('Bestätigen und freischalten');
    await page.locator('#admin-2fa-code').fill('12');
    await page.locator('#admin-2fa-ok').click();
    await expect(page.locator('#admin-2fa-fehler')).toContainText('6-stelligen Code');
    await page.locator('#admin-2fa-code').fill('111111');
    await page.locator('#admin-2fa-ok').click();
    await expect(page.locator('#admin-2fa-fehler')).toContainText('Der Code stimmt nicht');
    await expect(listen(page)).toBeHidden();
    await page.locator('#admin-2fa-code').fill('654321');
    await page.locator('#admin-2fa-code').press('Enter');
    await expect(listen(page)).toBeVisible();
    await expect(gate(page)).toBeHidden();
    await expect(page.locator('.admin-2fa-aktiv')).toContainText('gilt 12 Stunden');
    await expect(page.locator('#ff-toast')).toContainText('Verwaltung freigeschaltet');
  });

  test('Schon eingerichtet: nur Code; nach Ablauf der Freischaltung erneut', async ({ page }) => {
    await start(page, { eingerichtet: true, freigeschaltet: false, code: '222333' });
    await verwaltung(page);
    await expect(page.locator('#admin-2fa-titel')).toHaveText('Verwaltung freischalten');
    await expect(page.locator('#admin-2fa-start')).toBeHidden();
    await expect(page.locator('#admin-2fa-einrichten')).toBeHidden();
    await page.locator('#admin-2fa-code').fill('222333');
    await page.locator('#admin-2fa-ok').click();
    await expect(listen(page)).toBeVisible();
    // 12 Stunden später: Server bestätigt die Admin-Rechte nicht mehr -> beim nächsten Öffnen wieder Code
    await page.evaluate(() => { window.__ffTestMfa = { ...window.__ffTestMfa, freigeschaltet: false }; });
    await page.locator('[data-account-tab="profil"]').click();
    await page.locator('[data-account-tab="admin"]').click();
    await expect(gate(page)).toBeVisible();
    await expect(listen(page)).toBeHidden();
  });

  test('Authenticator wechseln: Eintrag entfernt, neu einrichten', async ({ page }) => {
    await start(page, { eingerichtet: true, freigeschaltet: true, code: '123456' });
    await verwaltung(page);
    await expect(listen(page)).toBeVisible();
    page.once('dialog', d => d.accept());
    await page.locator('#admin-2fa-wechseln').click();
    await expect(gate(page)).toBeVisible();
    await expect(page.locator('#admin-2fa-start')).toBeVisible();
    expect(await page.evaluate(() => window.__ffTestMfa.eingerichtet)).toBe(false);
  });

  test('Nicht auf der Admin-Liste: keine Verwaltung, kein Code', async ({ page }) => {
    await page.addInitScript(() => { window.__ffTestAdmin = false; });
    await page.goto('/');
    await setupCloud(page, { workspaces: {} });
    await loginWithCloud(page, { ...TEST_USER, email: 'kollege@oekop.de' });
    await page.locator('#btn-account').click();
    await expect(page.locator('#account-menu')).toBeVisible();
    await expect(page.locator('#account-menu-admin')).toBeHidden();
    await page.locator('#account-menu-settings').click();
    await expect(page.locator('#account-tab-admin')).toBeHidden();
  });
});
