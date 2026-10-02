import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Der Dokumentenscanner lädt OpenCV.js (~9 MB WASM) erst beim ersten Öffnen
// nach (siehe ensureScanLibs() in main.js) und braucht eine virtuelle Kamera
// (--use-fake-device-for-media-stream, siehe playwright.config.js) statt
// einer echten. Beides macht den ersten Testlauf deutlich langsamer als die
// übrige Suite — eigenes, großzügiges Timeout. Serieller Modus: zwei
// parallele OpenCV-WASM-Initialisierungen überlasten die Worker spürbar.
//
// Das Bild der Testkamera enthält kein Blatt — die Bildverarbeitung
// (Erkennung, Entzerrung, Filter) wird deshalb mit einem künstlich
// erzeugten "Foto" geprüft: schräg liegendes Blatt mit Text und Schatten auf
// einem Holztisch, über "Galerie" bzw. direkt über window.__ffTestScan.

// Erzeugt im Browser ein Foto eines Blattes (1200×1600). quad = echte Ecken
// (tl, tr, br, bl) in Pixeln.
function makeDocumentPhoto() {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 1600;
  const g = c.getContext('2d');
  const wood = g.createLinearGradient(0, 0, 1200, 1600);
  wood.addColorStop(0, '#3a2f25');
  wood.addColorStop(1, '#6b5a48');
  g.fillStyle = wood;
  g.fillRect(0, 0, 1200, 1600);
  const quad = [[230, 190], [1000, 240], [960, 1370], [180, 1320]];
  g.beginPath();
  quad.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = '#f4f1ea';
  g.fill();
  g.save();
  g.clip();
  // Schatten von Hand/Handy über der linken Blatthälfte
  const shadow = g.createLinearGradient(150, 0, 700, 0);
  shadow.addColorStop(0, 'rgba(0,0,0,0.38)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = shadow;
  g.fillRect(0, 0, 1200, 1600);
  g.fillStyle = '#1e1e1e';
  g.font = 'bold 30px sans-serif';
  for (let i = 0; i < 18; i++) g.fillText('Lieferschein 4711 – Dinkel 12,5 t', 290, 340 + i * 52);
  g.restore();
  return { canvas: c, quad: quad.map(([x, y]) => ({ x, y })) };
}

async function openScannerOnTermin(page) {
  await page.locator('#tk-scan-btn').click();
  await expect(page.locator('#scan-modal-overlay')).toBeVisible();
}

test.describe('Dokumentenscanner (Kontrolle)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    // Auto-Auslöser aus: das Testkamerabild soll nicht zufällig auslösen.
    await page.addInitScript(() => { try { localStorage.setItem('feldfolio-scan-auto', 'false'); } catch {} });
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await gotoKontrolleKalender(page);
    await page.evaluate(() => window.__ffTestTk.addEvent());
    await openFirstTermin(page, 'dokumente');
    await page.evaluate(() => {
      window.__ffTestUploadPhotoOverride = async (file) => {
        window.__lastScanUpload = { name: file.name, type: file.type, size: file.size };
        return 'test/' + file.name;
      };
    });
  });

  test('Kamerawahl: Hauptkamera vor Weitwinkel/Tele (Android und iPhone)', async ({ page }) => {
    const ranked = await page.evaluate(() => {
      const cams = (labels) => labels.map((label, i) => ({ kind: 'videoinput', deviceId: 'id' + i, label }));
      const rank = (labels) => window.__ffTestScan.rankBackCameras(cams(labels)).map(d => d.label);
      return {
        samsung: rank(['camera2 1, facing front', 'camera2 2, facing back', 'camera2 0, facing back', 'camera2 3, facing back']),
        iphone: rank(['Frontkamera', 'Rückseitige Ultraweitwinkelkamera', 'Rückkamera', 'Rückseitige Telekamera']),
        iphoneEn: rank(['Front Camera', 'Back Ultra Wide Camera', 'Back Camera', 'Back Telephoto Camera']),
        noLabels: rank(['', ''])
      };
    });
    expect(ranked.samsung[0]).toBe('camera2 0, facing back');
    expect(ranked.samsung).not.toContain('camera2 1, facing front');
    expect(ranked.iphone[0]).toBe('Rückkamera');
    expect(ranked.iphoneEn[0]).toBe('Back Camera');
    expect(ranked.noLabels).toHaveLength(2);
  });

  test('Live-Rahmen: Zittern wird geglättet, Sprünge erst nach Bestätigung übernommen', async ({ page }) => {
    const r = await page.evaluate(() => {
      const t = window.__ffTestScan.createTracker();
      const q = (dx = 0) => [{ x: 0.2 + dx, y: 0.2 }, { x: 0.8 + dx, y: 0.2 }, { x: 0.8 + dx, y: 0.8 }, { x: 0.2 + dx, y: 0.8 }];
      const out = {};
      t.update(q(), 0);
      out.afterOne = t.quad;              // einzelne Erkennung reicht nicht
      t.update(q(0.004), 100);
      out.shown = !!t.quad;
      t.update(q(0.02), 200);             // kleine Abweichung → weich nachgeführt
      out.smoothedX = t.quad[0].x;
      t.update(q(0.3), 300);              // Sprung (z. B. Tischkante)
      out.afterJump = t.quad[0].x;
      t.update(q(0.3), 400);
      t.update(q(0.3), 500);              // bestätigt
      out.afterConfirm = t.quad[0].x;
      t.update(null, 600);                // kurzer Aussetzer
      out.heldDuringMiss = !!t.quad;
      return out;
    });
    expect(r.afterOne).toBeNull();
    expect(r.shown).toBe(true);
    expect(r.smoothedX).toBeGreaterThan(0.2);
    expect(r.smoothedX).toBeLessThan(0.22);
    expect(r.afterJump).toBeLessThan(0.25);
    expect(r.afterConfirm).toBeCloseTo(0.5, 5);
    expect(r.heldDuringMiss).toBe(true);
  });

  test('Blatt-Erkennung, Entzerrung auf A4 und Dokument-Filter entfernen den Schatten', async ({ page }) => {
    await page.evaluate(() => window.__ffTestScan.ensureLibs());
    const r = await page.evaluate(`(() => {
      const { canvas, quad } = (${makeDocumentPhoto.toString()})();
      const t = window.__ffTestScan;
      const small = document.createElement('canvas');
      small.width = 360; small.height = 480;
      small.getContext('2d').drawImage(canvas, 0, 0, 360, 480);
      const found = t.detect(small);
      const err = found ? Math.max(...found.map((p, i) => Math.hypot(p.x - quad[i].x / 1200, p.y - quad[i].y / 1600))) : null;
      const warped = t.warp(canvas, quad);
      const doc = t.filter(warped, 'document');
      const bw = t.filter(warped, 'bw');
      const mean = (c, x0, y0, w, h) => {
        const d = c.getContext('2d').getImageData(x0, y0, w, h).data;
        let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
        return s / (d.length / 4);
      };
      // Papier im Schatten (linker Rand, zwischen zwei Textzeilen) vorher/nachher
      const y = Math.round(warped.height * 0.72);
      const bwData = bw.getContext('2d').getImageData(0, 0, bw.width, bw.height).data;
      const bwValues = new Set();
      for (let i = 0; i < bwData.length; i += 4 * 97) bwValues.add(bwData[i]);
      return {
        err, w: warped.width, h: warped.height, a4: warped.dataset.a4,
        shadowBefore: mean(warped, 10, y, 30, 20), shadowAfter: mean(doc, 10, y, 30, 20),
        bwValues: [...bwValues]
      };
    })()`);
    expect(r.err).not.toBeNull();
    expect(r.err).toBeLessThan(0.03);                  // Ecken auf 3 % genau
    expect(r.h / r.w).toBeCloseTo(Math.SQRT2, 2);      // auf A4 gerundet
    expect(r.a4).toBe('1');
    expect(r.w).toBeGreaterThan(700);                  // volle Auflösung, kein Vorschaubild
    expect(r.shadowBefore).toBeLessThan(200);          // Schatten im Original
    expect(r.shadowAfter).toBeGreaterThan(225);        // Papier nach "Dokument" weiß
    expect(r.bwValues.every(v => v === 0 || v === 255)).toBe(true);
  });

  test('Galerie-Foto: Ecken erkannt, Filter + Drehen, Seite landet im PDF', async ({ page }) => {
    await openScannerOnTermin(page);
    const png = await page.evaluate(`(() => (${makeDocumentPhoto.toString()})().canvas.toDataURL('image/png'))()`);
    await page.setInputFiles('#scan-gallery-input', {
      name: 'lieferschein.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64')
    });
    await expect(page.locator('#scan-crop-view')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('#scan-crop-hint')).toHaveText('Ecken prüfen – bei Bedarf ziehen');
    const quad = await page.evaluate(() => window.__ffTestScan.cropQuad());
    expect(quad[0].x).toBeCloseTo(230 / 1200, 1);
    expect(quad[2].y).toBeCloseTo(1370 / 1600, 1);

    await page.locator('#scan-crop-confirm').click();
    await expect(page.locator('#scan-review-view')).toBeVisible();
    await expect(page.locator('#scan-review-busy')).toBeHidden({ timeout: 30000 });
    await expect(page.locator('.scan-filter-chip')).toHaveCount(4);
    await expect(page.locator('.scan-filter-chip[aria-checked="true"]')).toHaveText('Dokument');

    await page.locator('.scan-filter-chip[data-filter="gray"]').click();
    await expect(page.locator('.scan-filter-chip[aria-checked="true"]')).toHaveText('Graustufen');
    const before = await page.locator('#scan-review-canvas').evaluate(c => [c.width, c.height]);
    await page.locator('#scan-review-rotate').click();
    await expect.poll(() => page.locator('#scan-review-canvas').evaluate(c => [c.width, c.height])).toEqual([before[1], before[0]]);

    await page.locator('#scan-review-confirm').click();
    await expect(page.locator('#scan-camera-view')).toBeVisible();
    await expect(page.locator('.scan-thumb')).toHaveCount(1);
    const pages = await page.evaluate(() => window.__ffTestScan.pages());
    expect(pages[0].width).toBeGreaterThan(pages[0].height); // gedreht → quer
    expect(pages[0].a4).toBe(true);

    await page.locator('#scan-btn-finish').click();
    await expect(page.locator('#scan-modal-overlay')).toBeHidden();
    // Upload läuft asynchron über die Warteschlange — warten, bis er erfolgt ist.
    await expect.poll(() => page.evaluate(() => !!window.__lastScanUpload)).toBe(true);
    const upload = await page.evaluate(() => window.__lastScanUpload);
    expect(upload.type).toBe('application/pdf');
    // Filter-Wahl wird fürs nächste Mal gemerkt.
    expect(await page.evaluate(() => localStorage.getItem('feldfolio-scan-filter'))).toBe('gray');
  });

  test('Kamera: zwei Seiten aufnehmen legt einen PDF-Anhang an', async ({ page }) => {
    await openScannerOnTermin(page);
    await expect(page.locator('#scan-btn-capture')).toBeEnabled({ timeout: 30000 });
    // Vorschau ist das Video selbst (nicht mehr ein 5-fps-Canvas).
    await expect(page.locator('#scan-video')).toBeVisible();
    await expect.poll(() => page.locator('#scan-video').evaluate(v => v.videoWidth)).toBeGreaterThan(0);

    for (let i = 0; i < 2; i++) {
      await page.locator('#scan-btn-capture').click();
      await expect(page.locator('#scan-crop-view')).toBeVisible({ timeout: 60000 });
      await page.locator('#scan-crop-confirm').click();
      await expect(page.locator('#scan-review-view')).toBeVisible();
      await expect(page.locator('#scan-review-busy')).toBeHidden({ timeout: 30000 });
      await page.locator('#scan-review-confirm').click();
      await expect(page.locator('#scan-camera-view')).toBeVisible();
      await expect(page.locator('#scan-btn-capture')).toBeEnabled({ timeout: 30000 });
    }

    await expect(page.locator('.scan-thumb')).toHaveCount(2);
    await page.locator('#scan-btn-finish').click();
    await expect(page.locator('#scan-modal-overlay')).toBeHidden();
    // Upload läuft asynchron über die Warteschlange — warten, bis er erfolgt ist.
    await expect.poll(() => page.evaluate(() => !!window.__lastScanUpload)).toBe(true);
    const upload = await page.evaluate(() => window.__lastScanUpload);
    expect(upload.type).toBe('application/pdf');
    expect(upload.size).toBeGreaterThan(0);
    // Danach benennen: Dialog mit Vorschau der ersten Seite und Seitenzahl
    const dlg = page.locator('#docname-overlay');
    await expect(dlg).toBeVisible();
    await expect(page.locator('#docname-title')).toHaveText('Dokument benennen');
    await expect(page.locator('#docname-sub')).toContainText('2 Seiten');
    await expect(page.locator('#docname-preview img')).toBeVisible();
    await page.locator('#docname-input').fill('Lieferschein Futtermittel');
    await expect(page.locator('#docname-file')).toContainText('_Lieferschein Futtermittel.pdf');
    await page.locator('#docname-save').click();
    await expect(dlg).toBeHidden();
    const attachments = await page.evaluate(() => {
      const ev = window.__ffTestTk.getEvent(document.querySelector('.tk-card.selected').getAttribute('data-id'));
      return ev.attachments;
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0].type).toBe('application/pdf');
    expect(attachments[0].name).toMatch(/^\d{4}_.+_Lieferschein Futtermittel\.pdf$/);
  });

  test('„Neu“ im Zuschnitt verwirft die Aufnahme ohne sie zu übernehmen', async ({ page }) => {
    await openScannerOnTermin(page);
    await expect(page.locator('#scan-btn-capture')).toBeEnabled({ timeout: 30000 });
    await page.locator('#scan-btn-capture').click();
    await expect(page.locator('#scan-crop-view')).toBeVisible({ timeout: 60000 });
    await page.locator('#scan-crop-retake').click();
    await expect(page.locator('#scan-camera-view')).toBeVisible();
    await expect(page.locator('.scan-thumb')).toHaveCount(0);
    await expect(page.locator('#scan-btn-finish')).toBeDisabled();
  });

  test('Schließen ohne aufgenommene Seiten fragt nicht nach und schaltet die Kamera ab', async ({ page }) => {
    await openScannerOnTermin(page);
    await expect(page.locator('#scan-btn-capture')).toBeEnabled({ timeout: 30000 });
    await page.locator('#scan-btn-close').click();
    await expect(page.locator('#scan-modal-overlay')).toBeHidden();
    expect(await page.locator('#scan-video').evaluate(v => v.srcObject)).toBeNull();
  });

  test('Schließen mit nicht gespeicherten Seiten fragt nach', async ({ page }) => {
    await openScannerOnTermin(page);
    await expect(page.locator('#scan-btn-capture')).toBeEnabled({ timeout: 30000 });
    await page.locator('#scan-btn-capture').click();
    await expect(page.locator('#scan-crop-view')).toBeVisible({ timeout: 60000 });
    await page.locator('#scan-crop-confirm').click();
    await expect(page.locator('#scan-review-busy')).toBeHidden({ timeout: 30000 });
    await page.locator('#scan-review-confirm').click();
    await expect(page.locator('.scan-thumb')).toHaveCount(1);

    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#scan-btn-close').click();
    await expect(page.locator('#scan-modal-overlay')).toBeVisible();
    await expect(page.locator('.scan-thumb')).toHaveCount(1);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#scan-btn-close').click();
    await expect(page.locator('#scan-modal-overlay')).toBeHidden();
  });
});
