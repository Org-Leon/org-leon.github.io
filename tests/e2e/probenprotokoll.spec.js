import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Probenahmeprotokolle hängen an einem konkreten Termin (main.js,
// ev.probenprotokolle) — Login fälschen + Testtermin anlegen + auswählen,
// exakt wie beim Dokumentenscanner (scan.spec.js:20-31). Upload-Stub deckt
// sowohl die Anlagen-Datei innerhalb des Protokolls als auch den finalen
// PDF-Export ab (beide laufen über uploadPhoto(), siehe main.js).
async function openTerminWithEvent(page, overrides = {}) {
  await page.goto('/');
  await page.evaluate(() => window.__ffTestTk.loginFake());
  await gotoKontrolleKalender(page);
  const id = await page.evaluate((o) => window.__ffTestTk.addEvent(o), overrides);
  await openFirstTermin(page, 'protokolle');
  await page.evaluate(() => {
    let counter = 0;
    window.__ffTestUploadPhotoOverride = async (file) => {
      counter += 1;
      window.__lastProbenprotokollUploads = window.__lastProbenprotokollUploads || [];
      window.__lastProbenprotokollUploads.push({ name: file.name, type: file.type, size: file.size });
      return 'test/probenprotokoll-' + counter + '-' + file.name;
    };
  });
  return id;
}

// Füllt alle Pflichtangaben des gerade offenen Protokolls direkt über den
// Testhaken (Unterschriften lassen sich per Maus-Event nicht zuverlässig
// zeichnen, siehe AGENTS.md Punkt 2).
const FAKE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
async function fillRequired(page, eventId, { skipErklaerungen = false } = {}) {
  await page.evaluate(({ evId, png, skip }) => {
    const t = window.__ffTestProbenprotokoll;
    const id = t.getActive().id;
    const values = {
      'Nr Analysenproben': 'A-1', 'Name des Unternehmens': 'Musterhof GmbH', 'Straße Hausnummer': 'Feldweg 3',
      'PLZ  Ort': '12345 Musterstadt', 'Kundennummer': 'K-1', 'Bundesland': 'Bayern',
      'DatumZeitpunkt und Ort der Probenahme': '27.09.2026', 'UhrzeitZeitpunkt und Ort der Probenahme': '10:30',
      'Probenehmer Name': 'Max Probe'
    };
    if (!skip) {
      values['Der Beauftragung eines akkreditierten Labors als Unterauftragnehmer der Kontrollstelle wird zugestimmt'] = true;
      values['Über die Bedeutung der Gegenprobe und Lagerung der Gegenproben wurde ich informiert'] = true;
      values['Die genannten Angaben werden bestätigt'] = true;
    }
    Object.entries(values).forEach(([k, v]) => t.setValue(evId, id, k, v));
    t.setSignature(evId, id, 'signatureProbenehmer', png);
    t.setSignature(evId, id, 'signatureBetriebsinhaber', png);
  }, { evId: eventId, png: FAKE_PNG, skip: skipErklaerungen });
}

test.describe('Probenahmeprotokoll (Kontrolle)', () => {
  // Die Vorlage stammte ursprünglich aus einem ausgefüllten Beispiel — sie
  // darf keine Unterschriften, Kreuz-Markierungen oder Beispielwerte mehr
  // enthalten, sonst tauchen sie in jedem Export wieder auf.
  test('Vorlage ist leer: keine Unterschriften, Markierungen oder Beispielwerte', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch('/probenahmeprotokoll-vorlage.pdf')).arrayBuffer());
      const raw = new TextDecoder('latin1').decode(bytes);
      const doc = await PDFLib.PDFDocument.load(bytes);
      const form = doc.getForm();
      const annots = doc.getPage(0).node.Annots().asArray()
        .map(r => String(doc.context.lookup(r).get(PDFLib.PDFName.of('Subtype'))));
      const filled = form.getFields().filter(f =>
        (f instanceof PDFLib.PDFTextField && f.getText()) ||
        (f instanceof PDFLib.PDFCheckBox && f.isChecked()) ||
        (f instanceof PDFLib.PDFRadioGroup && f.getSelected())).map(f => f.getName());
      return {
        fillSign: raw.includes('ADBE_FillSign'),
        signatureFields: form.getFields().filter(f => f instanceof PDFLib.PDFSignature).length,
        nonWidgetAnnots: annots.filter(s => s !== '/Widget'),
        filled
      };
    });
    expect(result.fillSign).toBe(false);
    expect(result.signatureFields).toBe(0);
    expect(result.nonWidgetAnnots).toEqual([]);
    expect(result.filled).toEqual([]);
  });

  test('Neues Protokoll übernimmt Betrieb/Adresse/Kundennummer aus dem Termin', async ({ page }) => {
    const id = await openTerminWithEvent(page, {
      kunde: 'Musterhof GmbH', strasse: 'Feldweg 3', plz: '12345', ort: 'Musterstadt', kundennummer: 'K-999'
    });
    await page.locator('#tk-probenprotokoll-new').click();
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeVisible();

    const values = await page.evaluate((evId) => window.__ffTestProbenprotokoll.getActive() && window.__ffTestProbenprotokoll.get(evId, window.__ffTestProbenprotokoll.getActive().id).values, id);
    expect(values['Name des Unternehmens']).toBe('Musterhof GmbH');
    expect(values['Straße Hausnummer']).toBe('Feldweg 3');
    expect(values['PLZ  Ort']).toBe('12345 Musterstadt');
    expect(values['Kundennummer']).toBe('K-999');
  });

  test('Alle Feldtypen (Text, Checkbox mit Text, Radio) lassen sich ausfüllen', async ({ page }) => {
    await openTerminWithEvent(page);
    await page.locator('#tk-probenprotokoll-new').click();

    await page.locator('#pp-field-Probe').fill('Weizen');
    await page.locator('label:has-text("Eigene Produktion") input[type="radio"]').first().check();
    await page.locator('label:has-text("Lagerbezeichnung") input[type="checkbox"]').first().check();
    await page.locator('[data-field="Ort Lager"]').fill('Halle 2');
    await page.locator('label:has-text("Routine") input[type="radio"]').first().check();

    const values = await page.evaluate(() => window.__ffTestProbenprotokoll.getActive().values);
    expect(values['Probe']).toBe('Weizen');
    expect(values['Group10']).toBe('Auswahl1');
    expect(values['Probeort1']).toBe(true);
    expect(values['Ort Lager']).toBe('Halle 2');
    expect(values['Group9']).toBe('Auswahl1');
  });

  test('Anlagen-Datei anhängen wird im Protokoll gespeichert', async ({ page }) => {
    await openTerminWithEvent(page);
    await page.locator('#tk-probenprotokoll-new').click();

    await page.setInputFiles('#pp-anlage-file-input', {
      name: 'etikett.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-jpeg-bytes')
    });
    // Ohne echtes Supabase-Storage im Testlauf liefert getPhotoUrl() für den
    // gestubbten Pfad keine echte Signed URL — die Karte rendert dann den
    // bestehenden .tk-attachment-error-Zustand (siehe renderTerminkalender-
    // Attachments/renderProbenprotokollAnlagenGrid, main.js), ganz ohne
    // Entfernen-Button. Dieser Test prüft daher nur die Datenseite
    // (anlagenDateien), nicht das Thumbnail-Rendering selbst.
    await expect(page.locator('#pp-anlagen-grid .tk-attachment').first()).toBeVisible();
    const afterAdd = await page.evaluate(() => window.__ffTestProbenprotokoll.getActive().anlagenDateien);
    expect(afterAdd).toHaveLength(1);
    expect(afterAdd[0].name).toBe('etikett.jpg');
    expect(afterAdd[0].type).toBe('image/jpeg');
  });

  test('PDF-Export landet als Anhang bei "Fotos & Dateien" des Termins (kein Download)', async ({ page }) => {
    const id = await openTerminWithEvent(page, { kunde: 'Musterhof GmbH' });
    await page.locator('#tk-probenprotokoll-new').click();
    await page.locator('#pp-field-Probe').fill('Hafer');
    await fillRequired(page, id);

    await page.locator('#probenprotokoll-modal-export').click();
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeHidden();

    const attachments = await page.evaluate((evId) => window.__ffTestTk.getEvent(evId).attachments, id);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toMatch(/Probenahmeprotokoll\.pdf$/);
  });

  test('Export ist blockiert, solange Pflichtangaben fehlen, und markiert die Felder', async ({ page }) => {
    const id = await openTerminWithEvent(page, { kunde: 'Musterhof GmbH', strasse: 'Feldweg 3', plz: '12345', ort: 'Musterstadt', kundennummer: 'K-1' });
    await page.locator('#tk-probenprotokoll-new').click();
    await page.locator('#probenprotokoll-modal-export').click();

    // Modal bleibt offen, kein Anhang, Fehlerliste sichtbar.
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeVisible();
    const error = page.locator('#probenprotokoll-modal-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Nr. Analyseproben');
    await expect(error).toContainText('Bundesland');
    await expect(error).toContainText('Uhrzeit');
    await expect(error).toContainText('Unterschrift des Probenehmers');
    await expect(error).toContainText('Bestätigung der Angaben');
    // Vorbefüllte Felder (Kunde/Adresse/Datum) gelten bereits als ausgefüllt.
    await expect(error).not.toContainText('Name des Unternehmens');
    await expect(error).not.toContainText('Datum,');
    const attachments = await page.evaluate((evId) => window.__ffTestTk.getEvent(evId).attachments, id);
    expect(attachments).toHaveLength(0);

    // Markierung verschwindet, sobald das Feld ausgefüllt wird.
    const nrField = page.locator('.pp-field', { has: page.locator('#pp-field-Nr_Analysenproben') });
    await expect(nrField).toHaveClass(/pp-invalid/);
    await page.locator('#pp-field-Nr_Analysenproben').fill('A-123');
    await expect(nrField).not.toHaveClass(/pp-invalid/);
    await expect(error).not.toContainText('Nr. Analyseproben');
  });

  test('"Annahme und Verwahrung abgelehnt" macht die übrigen Erklärungen optional', async ({ page }) => {
    const id = await openTerminWithEvent(page);
    await page.locator('#tk-probenprotokoll-new').click();
    await fillRequired(page, id, { skipErklaerungen: true });

    await page.locator('#probenprotokoll-modal-export').click();
    await expect(page.locator('#probenprotokoll-modal-error')).toContainText('Zustimmung zur Laborbeauftragung');

    await page.locator('label:has-text("Die Annahme und Verwahrung wurde abgelehnt") input[type="checkbox"]').check();
    await expect(page.locator('#probenprotokoll-modal-error')).toBeHidden();

    await page.locator('#probenprotokoll-modal-export').click();
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeHidden();
    const attachments = await page.evaluate((evId) => window.__ffTestTk.getEvent(evId).attachments, id);
    expect(attachments).toHaveLength(1);
  });

  test('Löschen entfernt das Protokoll aus der Liste', async ({ page }) => {
    await openTerminWithEvent(page);
    await page.locator('#tk-probenprotokoll-new').click();
    await page.locator('#probenprotokoll-modal-close').click();
    await expect(page.locator('.probenprotokoll-row')).toHaveCount(1);

    page.once('dialog', (d) => d.accept());
    await page.locator('.probenprotokoll-row-delete').click();
    await expect(page.locator('.probenprotokoll-row')).toHaveCount(0);
  });

  // Barcode-Scanner (openBarcodeScanner in main.js): ein Canvas mit echtem
  // QR-Code dient als Kamera (window.__ffTestBarcodeStream) — die Erkennung
  // selbst läuft unverändert (BarcodeDetector bzw. ZXing).
  async function showBarcode(page, text) {
    await page.evaluate(async (t) => {
      const code = await window.__ffTestBarcode.qrCanvas(t);
      const cam = document.createElement('canvas');
      cam.width = 640; cam.height = 480;
      const ctx = cam.getContext('2d');
      const draw = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 480); ctx.drawImage(code, 140, 60); };
      draw();
      clearInterval(window.__barcodeDrawTimer);
      window.__barcodeDrawTimer = setInterval(draw, 50);
      window.__ffTestBarcodeStream = () => cam.captureStream(20);
    }, text);
  }

  test('Barcode-Scanner trägt Probenummern ein, weitere Nummern werden angehängt', async ({ page }) => {
    await openTerminWithEvent(page);
    await page.locator('#tk-probenprotokoll-new').click();
    const nr = page.locator('#pp-field-Nr_Analysenproben');

    await showBarcode(page, 'PR-2026-0815');
    await page.locator('[data-scan-field="Nr Analysenproben"]').click();
    await expect(nr).toHaveValue('PR-2026-0815', { timeout: 10000 });
    await expect(page.locator('#barcode-overlay')).toBeHidden();
    expect(await page.evaluate(() => window.__ffTestBarcode.streamActive())).toBe(false);

    // Zweite Probe: wird angehängt; dieselbe Nummer erneut nicht doppelt.
    await showBarcode(page, 'PR-2026-0816');
    await page.locator('[data-scan-field="Nr Analysenproben"]').click();
    await expect(nr).toHaveValue('PR-2026-0815, PR-2026-0816', { timeout: 10000 });
    await page.locator('[data-scan-field="Nr Analysenproben"]').click();
    await expect(page.locator('#barcode-overlay')).toBeHidden({ timeout: 10000 });
    await expect(nr).toHaveValue('PR-2026-0815, PR-2026-0816');

    await showBarcode(page, 'GP-77');
    await page.locator('[data-scan-field="Nr der Gegenproben"]').click();
    await expect(page.locator('#pp-field-Nr_der_Gegenproben')).toHaveValue('GP-77', { timeout: 10000 });

    const values = await page.evaluate(() => window.__ffTestProbenprotokoll.getActive().values);
    expect(values['Nr Analysenproben']).toBe('PR-2026-0815, PR-2026-0816');
    expect(values['Nr der Gegenproben']).toBe('GP-77');
  });

  test('Barcode-Scanner abbrechen schaltet die Kamera ab und lässt das Feld leer', async ({ page }) => {
    await openTerminWithEvent(page);
    await page.locator('#tk-probenprotokoll-new').click();
    // Virtuelle Testkamera (playwright.config.js) — zeigt keinen Barcode.
    await page.locator('[data-scan-field="Nr Analysenproben"]').click();
    await expect(page.locator('#barcode-overlay')).toBeVisible();
    await expect(page.locator('#barcode-status')).toHaveText('Barcode in den Rahmen halten.', { timeout: 10000 });
    expect(await page.evaluate(() => window.__ffTestBarcode.streamActive())).toBe(true);

    await page.locator('#barcode-close').click();
    await expect(page.locator('#barcode-overlay')).toBeHidden();
    expect(await page.evaluate(() => window.__ffTestBarcode.streamActive())).toBe(false);
    await expect(page.locator('#pp-field-Nr_Analysenproben')).toHaveValue('');
    // Protokoll-Modal bleibt offen.
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeVisible();
  });
});
