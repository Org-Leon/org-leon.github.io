import { test, expect } from '@playwright/test';
import { gotoTab } from './helpers.js';

// Cross Check (FB.09.06.10) — gleiches Formular-System wie das
// Probenahmeprotokoll (TK_FORMULARE in main.js): hängt am Termin, füllt die
// Originalvorlage public/crosscheck-vorlage.pdf und speichert den Export als
// Anhang bei "Fotos & Dateien".
const FAKE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function openTerminWithEvent(page, overrides = {}) {
  await page.goto('/');
  await page.evaluate(() => window.__ffTestTk.loginFake());
  await gotoTab(page, 'Terminkalender');
  const id = await page.evaluate((o) => window.__ffTestTk.addEvent(o), overrides);
  await page.locator('.tk-card').first().click();
  await page.evaluate(() => {
    let counter = 0;
    window.__uploads = [];
    window.__ffTestUploadPhotoOverride = async (file) => {
      counter += 1;
      const path = 'test/crosscheck-' + counter + '-' + file.name;
      window.__uploads.push({ path, name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
      return path;
    };
    // Anlagen-Bytes für den Export direkt aus den "hochgeladenen" Dateien.
    window.__ffTestFetchBytesOverride = async (path) => window.__uploads.find(u => u.path === path).bytes;
  });
  return id;
}

async function fillRequired(page, eventId) {
  await page.evaluate(({ evId, png }) => {
    const t = window.__ffTestCrossCheck;
    const id = t.getActive().id;
    const values = {
      'Kontrollstelle': 'Kontrollstelle Nord', 'Codenummer': 'DE-ÖKO-006',
      'Group1': 'Auswahl2', 'Name_2': 'Mühle Süd GmbH', 'Anschrift_2': 'Mühlweg 1\n80000 München',
      'ProduktRow1': 'Dinkel', 'Lieferdatum  LieferzeitraumRow1': '03/2026', 'MengeRow1': '12 t',
      'Nummer und Datum Lieferschein  RechnungRow1': 'LS 4711 vom 12.03.2026',
      'Group2': 'Auswahl1', 'Group3': 'Auswahl2'
    };
    Object.entries(values).forEach(([k, v]) => t.setValue(evId, id, k, v));
    t.setSignature(evId, id, 'signatureKontrolleur', png);
  }, { evId: eventId, png: FAKE_PNG });
}

test.describe('Cross Check (Terminkalender)', () => {
  test('Vorlage ist leer und hat alle erwarteten Formularfelder', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch('/crosscheck-vorlage.pdf')).arrayBuffer());
      const doc = await PDFLib.PDFDocument.load(bytes);
      const form = doc.getForm();
      const filled = form.getFields().filter(f =>
        (f instanceof PDFLib.PDFTextField && f.getText()) ||
        (f instanceof PDFLib.PDFCheckBox && f.isChecked()) ||
        (f instanceof PDFLib.PDFRadioGroup && f.getSelected())).map(f => f.getName());
      return { names: form.getFields().map(f => f.getName()), filled };
    });
    expect(result.filled).toEqual([]);
    for (const name of ['Kontrollstelle', 'Codenummer', 'Group1', 'Name', 'Anschrift', 'Name_2', 'Anschrift_2',
      'ProduktRow1', 'MengeRow1', 'Group2', 'Check Box2', 'Check Box3', 'Group3', 'Datum', 'sonstiges']) {
      expect(result.names).toContain(name);
    }
  });

  test('Neuer Cross Check übernimmt Betrieb und Adresse aus dem Termin', async ({ page }) => {
    const id = await openTerminWithEvent(page, { kunde: 'Musterhof GmbH', strasse: 'Feldweg 3', plz: '12345', ort: 'Musterstadt' });
    await page.locator('#tk-crosscheck-new').click();
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeVisible();
    await expect(page.locator('#probenprotokoll-modal-title')).toHaveText('Cross Check');
    await expect(page.locator('#probenprotokoll-modal-delete')).toContainText('Cross Check löschen');

    const values = await page.evaluate(() => window.__ffTestCrossCheck.getActive().values);
    expect(values['Name']).toBe('Musterhof GmbH');
    expect(values['Anschrift']).toBe('Feldweg 3\n12345 Musterstadt');
    expect(values['Datum']).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4}$/);
    // Protokoll-Liste bleibt unberührt.
    expect(await page.evaluate((evId) => window.__ffTestTk.getEvent(evId).probenprotokolle.length, id)).toBe(0);
  });

  test('Empfänger wählen schlägt Empfängerprüfung vor, deren Fragen sind nur dann aktiv', async ({ page }) => {
    await openTerminWithEvent(page);
    await page.locator('#tk-crosscheck-new').click();
    const frage = page.locator('[data-field="Check Box2"]');
    await expect(frage).toBeDisabled();

    await page.locator('[data-field="Group1"][value="Auswahl1"]').check();
    await expect(page.locator('[data-field="Group2"][value="Auswahl2"]')).toBeChecked();
    await expect(frage).toBeEnabled();
    await frage.check();
    expect((await page.evaluate(() => window.__ffTestCrossCheck.getActive().values))['Check Box2']).toBe(true);

    await page.locator('[data-field="Group2"][value="Auswahl1"]').check();
    await expect(frage).toBeDisabled();
  });

  test('Export ist blockiert, solange Pflichtangaben fehlen', async ({ page }) => {
    const id = await openTerminWithEvent(page, { kunde: 'Musterhof GmbH', strasse: 'Feldweg 3', plz: '12345', ort: 'Musterstadt' });
    await page.locator('#tk-crosscheck-new').click();
    await page.locator('#probenprotokoll-modal-export').click();

    const error = page.locator('#probenprotokoll-modal-error');
    await expect(error).toBeVisible();
    for (const label of ['Kontrollstelle', 'Codenummer', 'Empfänger oder Lieferant', 'Produkt', 'Menge',
      'Zentrale Fragestellung', 'Mit der Bitte um', 'Unterschrift Kontrolleur / Kontrollstelle']) {
      await expect(error).toContainText(label);
    }
    await expect(error).not.toContainText('Name des Unternehmens');
    expect(await page.evaluate((evId) => window.__ffTestTk.getEvent(evId).attachments.length, id)).toBe(0);

    // Empfängerprüfung ohne angekreuzte Frage ist unvollständig.
    await fillRequired(page, id);
    await page.locator('[data-field="Group2"][value="Auswahl2"]').check();
    await expect(error).toContainText('Frage zur Empfängerprüfung');
    await page.locator('[data-field="Check Box3"]').check();
    await expect(error).toBeHidden();
  });

  test('PDF-Export: Originalformular geflacht, Unterschrift + Anlage, als Anhang am Termin', async ({ page }) => {
    const id = await openTerminWithEvent(page, { kunde: 'Musterhof GmbH', strasse: 'Feldweg 3', plz: '12345', ort: 'Musterstadt' });
    await page.locator('#tk-crosscheck-new').click();
    await page.locator('label:has-text("Lieferschein") input[type="checkbox"]').first().check();
    await page.setInputFiles('#pp-anlage-file-input', {
      name: 'lieferschein.pdf', mimeType: 'application/pdf',
      buffer: Buffer.from(await page.evaluate(async () => {
        const d = await PDFLib.PDFDocument.create();
        d.addPage([595, 842]);
        return Array.from(await d.save());
      }))
    });
    await expect.poll(() => page.evaluate(() => window.__ffTestCrossCheck.getActive().anlagenDateien.length)).toBe(1);
    await fillRequired(page, id);

    await page.locator('#probenprotokoll-modal-export').click();
    await expect(page.locator('#probenprotokoll-modal-overlay')).toBeHidden();

    const attachments = await page.evaluate((evId) => window.__ffTestTk.getEvent(evId).attachments, id);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toMatch(/_Cross Check\.pdf$/);

    const pdf = await page.evaluate(async () => {
      const upload = window.__uploads.find(u => u.name.endsWith('Cross Check.pdf'));
      const doc = await PDFLib.PDFDocument.load(upload.bytes);
      const xobjects = doc.getPage(0).node.Resources().lookup(PDFLib.PDFName.of('XObject'), PDFLib.PDFDict);
      return { pages: doc.getPageCount(), fields: doc.getForm().getFields().length, xobjects: xobjects.keys().length };
    });
    expect(pdf.pages).toBe(2);        // Formular + angehängter Lieferschein
    expect(pdf.fields).toBe(0);       // geflacht, nicht mehr editierbar
    expect(pdf.xobjects).toBeGreaterThan(2); // Vorlage hat 2 Bilder (Logos) + Unterschrift + Feld-Ansichten

    // Liste im Termin zeigt den Cross Check als vollständig.
    await expect(page.locator('#tk-crosscheck-list .probenprotokoll-row')).toHaveCount(1);
    await expect(page.locator('#tk-crosscheck-list')).toContainText('Mühle Süd GmbH');
    await expect(page.locator('#tk-crosscheck-list')).toContainText('vollständig');
  });

  test('Löschen entfernt den Cross Check aus der Liste', async ({ page }) => {
    await openTerminWithEvent(page);
    await page.locator('#tk-crosscheck-new').click();
    await page.locator('#probenprotokoll-modal-close').click();
    await expect(page.locator('#tk-crosscheck-list .probenprotokoll-row')).toHaveCount(1);
    await expect(page.locator('#tk-probenprotokoll-list .probenprotokoll-row')).toHaveCount(0);

    page.once('dialog', (d) => d.accept());
    await page.locator('#tk-crosscheck-list .probenprotokoll-row-delete').click();
    await expect(page.locator('#tk-crosscheck-list .probenprotokoll-row')).toHaveCount(0);
  });
});
