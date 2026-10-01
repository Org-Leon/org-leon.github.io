// Erzeugt die modernisierten Formular-Entwürfe (nur zum Testen, getrennt
// von den produktiven Vorlagen in public/):
//   vorlagen-entwurf/probenahmeprotokoll-vorlage-modern.pdf
//   vorlagen-entwurf/crosscheck-vorlage-modern.pdf
// und — falls der Dev-Server läuft (npm run dev, Port 5173) — je ein über
// den ECHTEN App-Export ausgefülltes Muster (vorlagen-entwurf/muster/), das
// beweist, dass die Entwürfe mit exportProbenprotokollPdf() kompatibel sind.
//
//   node scripts/build-vorlagen-entwurf.mjs
//
// pdf-lib kommt wie in der App vom CDN (keine neue Abhängigkeit), das Layout
// steht in scripts/vorlagen-entwurf/builder.js.
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'vorlagen-entwurf');
const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
const DEV_URL = 'http://localhost:5173/';

const browser = await chromium.launch();
try {
  // 1) Vorlagen bauen
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ url: PDF_LIB });
  await page.addScriptTag({ path: path.join(__dirname, 'vorlagen-entwurf', 'builder.js') });
  const built = await page.evaluate(() => window.__buildVorlagenEntwurf());
  await mkdir(path.join(outDir, 'muster'), { recursive: true });
  const files = {
    probenahme: path.join(outDir, 'probenahmeprotokoll-vorlage-modern.pdf'),
    crosscheck: path.join(outDir, 'crosscheck-vorlage-modern.pdf')
  };
  await writeFile(files.probenahme, Buffer.from(built.probenahme, 'base64'));
  await writeFile(files.crosscheck, Buffer.from(built.crosscheck, 'base64'));
  console.log('Vorlagen geschrieben:', Object.values(files).map(f => path.relative(root, f)).join(', '));

  // 2) Muster über den echten App-Export (nur mit laufendem Dev-Server)
  const devUp = await fetch(DEV_URL).then(r => r.ok).catch(() => false);
  if (!devUp) {
    console.log('Dev-Server nicht erreichbar — Muster übersprungen (npm run dev starten und erneut ausführen).');
  } else {
    const app = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    // Die App lädt ihre Vorlage per fetch — hier stattdessen den Entwurf liefern.
    await app.route('**/probenahmeprotokoll-vorlage.pdf', async r => r.fulfill({ body: await readFile(files.probenahme), contentType: 'application/pdf' }));
    await app.route('**/crosscheck-vorlage.pdf', async r => r.fulfill({ body: await readFile(files.crosscheck), contentType: 'application/pdf' }));
    await app.goto(DEV_URL);
    const evId = await app.evaluate(() => {
      window.__ffTestTk.loginFake();
      window.__musterUploads = [];
      window.__ffTestUploadPhotoOverride = async (file) => {
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        window.__musterUploads.push({ name: file.name, b64: btoa(bin) });
        return 'muster/' + file.name;
      };
      const d = new Date(); d.setHours(9, 30, 0, 0);
      return window.__ffTestTk.addEvent({
        kunde: 'Obsthof Huber GbR', date: d, hasTime: true, auditart: 'Öko-Kontrolle',
        strasse: 'Am Streuobsthang 12', plz: '99084', ort: 'Erfurt', kundennummer: 'K-204711'
      });
    });
    // Unterschrift als kleiner Schriftzug (Canvas -> PNG)
    const signature = await app.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 360; c.height = 90;
      const g = c.getContext('2d');
      g.strokeStyle = '#1d2a4a'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath();
      for (let x = 10; x < 340; x += 2) { const y = 50 + Math.sin(x / 14) * 18 * Math.sin(x / 60) + (x % 80 < 3 ? -12 : 0); x === 10 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
      return c.toDataURL('image/png');
    });
    await app.locator('#kontrolle-switcher').click();
    await app.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
    await app.locator('.tk-card').first().click();
    await app.locator('#kontrollmappe [data-km-tab="protokolle"]').click();

    const fill = async (hookName, values, sigKeys) => {
      await app.evaluate(({ hookName, values, sigKeys, evId, signature }) => {
        const t = window[hookName];
        const id = t.getActive().id;
        Object.entries(values).forEach(([k, v]) => t.setValue(evId, id, k, v));
        sigKeys.forEach(k => t.setSignature(evId, id, k, signature));
      }, { hookName, values, sigKeys, evId, signature });
      await app.locator('#probenprotokoll-modal-export').click();
    };

    await app.locator('#tk-probenprotokoll-new').click();
    await fill('__ffTestProbenprotokoll', {
      'Nr Analysenproben': 'A-2026-0815', 'Nr der Gegenproben': 'G-2026-0815', 'Bundesland': 'Thüringen',
      'Probe': 'Tafeläpfel „Topaz“', 'Group10': 'Auswahl1', 'Produktionsmenge': 'Ernte 24.09.2026',
      'Charge': 'CH-2026-17 / MHD 30.11.2026', 'Menge': '4,2 t', 'Lagermenge': '3,1 t',
      'Probeort1': true, 'Ort Lager': 'Kühllager 2, Kiste 14', 'DatumZeitpunkt und Ort der Probenahme': '30.09.2026',
      'UhrzeitZeitpunkt und Ort der Probenahme': '10:15', 'Probenmenge': '2 × 1 kg', 'Analyse (Wirkstoff)': 'Pflanzenschutzmittel-Screening (Multimethode)',
      'Group9': 'Auswahl1', 'Anlage2': true,
      'Erläuterung zur Probenahme Flurstücksname u nummer bzw Gebäudebezeichnung LagerChargennummer': 'Probe aus drei Kisten der Charge CH-2026-17 gemischt, Gegenprobe versiegelt beim Betrieb verblieben.',
      'Probenehmer Name': 'Max Mustermann',
      'Der Beauftragung eines akkreditierten Labors als Unterauftragnehmer der Kontrollstelle wird zugestimmt': true,
      'Über die Bedeutung der Gegenprobe und Lagerung der Gegenproben wurde ich informiert': true,
      'Die genannten Angaben werden bestätigt': true, 'Text1': 'Erfurt, 30.09.2026'
    }, ['signatureProbenehmer', 'signatureBetriebsinhaber']);
    await app.waitForFunction(() => window.__musterUploads.length === 1, null, { timeout: 15000 });

    await app.locator('#tk-crosscheck-new').click();
    await fill('__ffTestCrossCheck', {
      'Kontrollstelle': 'Beispiel-Kontrollstelle GmbH', 'Codenummer': 'DE-ÖKO-000',
      'Group1': 'Auswahl2', 'Name_2': 'Bio-Baumschule Lindner KG', 'Anschrift_2': 'Gartenweg 5\n96050 Bamberg',
      'ProduktRow1': 'Apfel-Jungbäume\n(Unterlage M9)', 'Lieferdatum  LieferzeitraumRow1': '12.03.2026',
      'MengeRow1': '350 Stück', 'Nummer und Datum Lieferschein  RechnungRow1': 'LS 55123\nvom 12.03.2026',
      'Lieferschein': true, 'Rechnung': true, 'Group2': 'Auswahl1',
      'weitergehende Fragestellung': 'Bitte zusätzlich bestätigen, dass die Ware als ökologisch zertifiziert ausgeliefert wurde.',
      'Group3': 'Auswahl2'
    }, ['signatureKontrolleur']);
    await app.waitForFunction(() => window.__musterUploads.length === 2, null, { timeout: 15000 });

    const uploads = await app.evaluate(() => window.__musterUploads);
    const names = ['probenahmeprotokoll-muster.pdf', 'crosscheck-muster.pdf'];
    for (let i = 0; i < uploads.length; i++) {
      await writeFile(path.join(outDir, 'muster', names[i]), Buffer.from(uploads[i].b64, 'base64'));
    }
    console.log('Muster über den App-Export geschrieben:', names.map(n => 'vorlagen-entwurf/muster/' + n).join(', '));
  }
} finally {
  await browser.close();
}
