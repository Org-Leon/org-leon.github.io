import { test, expect } from '@playwright/test';
import { gotoTab } from './helpers.js';

// Der Dokumentenscanner lädt OpenCV.js (~9 MB WASM) + jscanify erst beim
// ersten Öffnen nach (siehe ensureScanLibs() in main.js) und braucht eine
// virtuelle Kamera (--use-fake-device-for-media-stream, siehe
// playwright.config.js) statt einer echten. Beides macht den ersten
// Testlauf deutlich langsamer als die übrige Suite — eigenes, großzügiges
// Timeout statt des globalen Default-Timeouts. Da jeder Test (fullyParallel)
// seinen eigenen, isolierten Browser-Kontext bekommt, lädt JEDER Test
// OpenCV.js einzeln neu — zwei davon gleichzeitig auf den zwei Workern
// (siehe playwright.config.js) überlastet das WASM-Init spürbar und lässt
// #scan-btn-capture sporadisch nicht rechtzeitig aktiv werden. Serieller
// Modus vermeidet die Worker-Konkurrenz innerhalb dieser Datei, ohne die
// globale workers-Einstellung für die übrige Suite anzufassen.
test.describe('Dokumentenscanner (Terminkalender)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Der Terminkalender-Umschalter ist ohne Anmeldung ausgeblendet (siehe
    // updateAccountButton() in main.js) — der dev-only Testhaken täuscht
    // eine Anmeldung vor, ohne ein echtes Supabase-Konto zu brauchen.
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await gotoTab(page, 'Terminkalender');
    // Termine entstehen sonst nur per Excel-Import — der dev-only Testhaken
    // legt stattdessen direkt einen Testtermin für heute an (liegt damit
    // automatisch in der aktuell sichtbaren Woche).
    await page.evaluate(() => window.__ffTestTk.addEvent());
    await page.locator('.tk-card').first().click();
    // Cloud-Upload ohne echten Login stubben (siehe uploadPhoto() in
    // supabase.js) — der Test prüft die lokale ev.attachments-Liste, kein
    // echtes Supabase-Konto ist dafür nötig.
    await page.evaluate(() => {
      window.__ffTestUploadPhotoOverride = async (file) => {
        window.__lastScanUpload = { name: file.name, type: file.type, size: file.size };
        return 'test/' + file.name;
      };
    });
  });

  test('Scan mit zwei Seiten legt einen PDF-Anhang an', async ({ page }) => {
    await page.locator('#tk-scan-btn').click();
    await expect(page.locator('#scan-modal-overlay')).toBeVisible();

    // Kamera-Bild + Kantenerkennungs-Loop brauchen einen Moment, bis das
    // erste Frame steht (virtuelle Testkamera + OpenCV.js-Nachladen).
    await expect(page.locator('#scan-btn-capture')).toBeEnabled({ timeout: 30000 });

    for (let i = 0; i < 2; i++) {
      await page.locator('#scan-btn-capture').click();
      await expect(page.locator('#scan-crop-view')).toBeVisible();
      await page.locator('#scan-crop-confirm').click();
      await expect(page.locator('#scan-camera-view')).toBeVisible();
    }

    await expect(page.locator('.scan-thumb')).toHaveCount(2);
    await expect(page.locator('#scan-btn-finish')).toBeEnabled();
    await page.locator('#scan-btn-finish').click();

    await expect(page.locator('#scan-modal-overlay')).toBeHidden();
    const upload = await page.evaluate(() => window.__lastScanUpload);
    expect(upload).toBeTruthy();
    expect(upload.type).toBe('application/pdf');
    expect(upload.size).toBeGreaterThan(0);

    const attachments = await page.evaluate(() => {
      const ev = window.__ffTestTk.getEvent(document.querySelector('.tk-card.selected').getAttribute('data-id'));
      return ev.attachments;
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0].type).toBe('application/pdf');
  });

  test('Erneut aufnehmen verwirft die aktuelle Seite ohne sie zu übernehmen', async ({ page }) => {
    await page.locator('#tk-scan-btn').click();
    await expect(page.locator('#scan-btn-capture')).toBeEnabled({ timeout: 30000 });

    await page.locator('#scan-btn-capture').click();
    await expect(page.locator('#scan-crop-view')).toBeVisible();
    await page.locator('#scan-crop-retake').click();
    await expect(page.locator('#scan-camera-view')).toBeVisible();
    await expect(page.locator('.scan-thumb')).toHaveCount(0);
    await expect(page.locator('#scan-btn-finish')).toBeDisabled();
  });

  test('Schließen ohne aufgenommene Seiten fragt nicht nach und verwirft direkt', async ({ page }) => {
    await page.locator('#tk-scan-btn').click();
    await expect(page.locator('#scan-modal-overlay')).toBeVisible();
    await page.locator('#scan-btn-close').click();
    await expect(page.locator('#scan-modal-overlay')).toBeHidden();
  });

  test('Schließen mit nicht gespeicherten Seiten fragt nach', async ({ page }) => {
    await page.locator('#tk-scan-btn').click();
    await expect(page.locator('#scan-btn-capture')).toBeEnabled({ timeout: 30000 });
    await page.locator('#scan-btn-capture').click();
    await expect(page.locator('#scan-crop-view')).toBeVisible();
    await page.locator('#scan-crop-confirm').click();
    await expect(page.locator('.scan-thumb')).toHaveCount(1);

    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#scan-btn-close').click();
    // Abgebrochen (dismiss) — Overlay bleibt offen, Seite bleibt erhalten.
    await expect(page.locator('#scan-modal-overlay')).toBeVisible();
    await expect(page.locator('.scan-thumb')).toHaveCount(1);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#scan-btn-close').click();
    await expect(page.locator('#scan-modal-overlay')).toBeHidden();
  });
});
