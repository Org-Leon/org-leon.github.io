import { test, expect } from '@playwright/test';
import { ladeShapeZip, rechteck } from './shapefile-helper.js';

// Nutzungsnachweis (FNN, PDF) mit den Shapes vergleichen: Bedeutung von
// Nutzungscodes lernen und Flächen ohne Kultur über die FLIK ergänzen.
// Alle Daten frei erfunden.

// PDF im Browser mit dem jsPDF der App bauen. zeilen: [[x, Text], …] je Zeile
async function pdfBauen(page, zeilen) {
  const b64 = await page.evaluate((zeilen) => {
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
    doc.setFontSize(8);
    zeilen.forEach((stuecke, i) => stuecke.forEach(([x, t]) => doc.text(t, x, 20 + i * 6)));
    return doc.output('datauristring').split(',')[1];
  }, zeilen);
  return Buffer.from(b64, 'base64');
}

test.describe('Nutzungsnachweis (FNN)', () => {
  test('Modul: Code + Klartext aus verschiedenen Ausdrucken, nur Codes aus den Shapes', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const m = await import('/src/fnn.js');
      const zeile = (y, ...stuecke) => stuecke.map(([x, s]) => ({ x, y, s }));
      // Bayern: Code und Text in eigenen Spalten, Text über drei Zeilen; davor Schlagnummer + Name
      const bayern = [[
        ...zeile(700, [39, '7'], [57, 'Hangacker'], [244, '434'], [266, 'Kleegras - Klee-'], [369, '2,7716']),
        ...zeile(690, [57, 'DEBYLI9999000024'], [266, '/Luzernegras-Gemisch']),
        ...zeile(680, [266, '(Leguminosen']),
        ...zeile(670, [266, 'überwiegen)']),
        ...zeile(660, [39, '8'], [57, 'Wiesenstück'], [244, '451'], [266, 'Wiesen'])
      ]];
      const by = m.fnnAuswerten(m.fnnZeilen(bayern), { codes: new Set(['434', '451']) });
      // Thüringen: FLIK und "Code: Text" in einer Zeile
      const th = m.fnnAuswerten(m.fnnZeilen([[...zeile(500, [61, '41.1'], [127, 'DETHLIAL99999X01'], [203, '111150: Winterweichweizen'], [633, '3,2500 ha'])]]));
      // gedreht (Sachsen-Anhalt): mehrere Paare in einer Zeile
      const st = m.fnnAuswerten(m.fnnZeilen([[...zeile(300, [162, '6,0554 118 - Winter-Emmer/-Einkorn'], [180, '5,2709 422 - Kleegras'])]]));
      return { by: [...by.codes], th: th.zeilen[0], st: [...st.codes] };
    });
    expect(r.by).toEqual([['434', 'Kleegras - Klee-/Luzernegras-Gemisch (Leguminosen überwiegen)'], ['451', 'Wiesen']]);
    expect(r.th).toEqual({ flik: 'DETHLIAL99999X01', ha: 3.25, code: '111150', text: 'Winterweichweizen', nummern: ['41.1'] });
    expect(r.st).toEqual([['118', 'Winter-Emmer/-Einkorn'], ['422', 'Kleegras']]);
  });

  test('Thüringen ohne Kultur in den Shapes: Nutzungsnachweis laden ergänzt die Kulturen über die FLIK', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.removeItem('feldfolio-nutzungscodes'); } catch { /* */ } });
    await page.evaluate(() => window.__ffTestTk.loginFake('test@example.com'));
    await page.locator('.segment-btn[data-view="compare"]').click();
    // VERONA-Format bis 2025: doppelte Feldnamen, FLIK in der 2. Spalte, Schlag in der 16., keine Kulturart
    const F = [['GEOWD_LCHA', 'C', 20], ['GEOWD_FREE', 'C', 20], ['GEOWD_ID', 'N', 10], ['GEOWD_ANTJ', 'C', 4], ['GEOWD_GEO_', 'C', 10], ['GEOWD_GEO_', 'N', 12, 4]];
    const flaechen = [[1, 'DETHLIAL99999X01', '41.1', 3.25], [2, 'DETHLIAL99999X02', '42', 2.5], [3, 'DETHLIGL99999Y03', '7', 1.5]];
    await ladeShapeZip(page, 'compare-file-add', 'Antrag_2025.zip', 'Antragsflächen Hauptnutzung_POLYGONE', F,
      flaechen.map(([id, flik, schlag, ha]) => ['PORTIA_1', flik, 9000 + id, '2025', schlag, ha.toFixed(4)]), flaechen.map((_, i) => rechteck(i)));
    await expect(page.locator('.cy-row')).toHaveCount(1);
    const liste = [['Kundennummer', 'PK Feld', 'Schlagnummer', 'Bezeichnung', 'Kategorie', 'Kultur', 'ha', 'Bundesland', 'Zugang Fläche', 'Status Feldstück'],
      ['1', 'a', '1', '41.1 AL99999X01', 'Getreide', 'Winterweizen', 3.25, 'Thüringen', '01.07.2018', 'Ökologische Erzeugnisse']];
    const b64 = await page.evaluate((aoa) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Liste'); return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }); }, liste);
    await page.setInputFiles('#sl-file', { name: 'Liste.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(b64, 'base64') });
    const kultur = page.locator('.sl-sec.is-kultur');
    await expect(kultur).toHaveAttribute('open', '');
    await expect(kultur.locator('.sl-fnn')).toContainText('3 Flächen ohne Kultur');

    const pdf = await pdfBauen(page, [
      [[10, '41.1'], [30, 'DETHLIAL99999X01'], [80, '111150: Winterweichweizen'], [180, '3,2500 ha']],
      [[10, '42'], [30, 'DETHLIAL99999X02'], [80, '330000: Sojabohnen'], [180, '2,5000 ha']],
      [[10, '7'], [30, 'DETHLIGL99999Y03'], [80, '451000: Wiesen'], [180, '1,5000 ha']]
    ]);
    await page.setInputFiles('#sl-fnn-file', { name: 'Hauptnutzungen.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page.locator('#sl-fnn-info')).toContainText('3 Flächen über die FLIK ergänzt', { timeout: 30000 });
    const kulturen = await kultur.locator('.sl-kitem .sl-liste').allTextContents();
    expect(kulturen.join(' ')).toContain('Winterweichweizen');
    expect(kulturen.join(' ')).toContain('Sojabohnen');
    expect(kulturen.join(' ')).toContain('Wiesen');
    await expect(kultur.locator('.sl-fnn')).not.toContainText('ohne Kultur.');
  });

  test('Nutzungsnachweis im Zip: unbekannte Codes werden beim Laden gelernt und gemerkt', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.removeItem('feldfolio-nutzungscodes'); } catch { /* */ } });
    const pdf = await pdfBauen(page, [
      [[10, '1'], [30, 'DETHLIAL99999Z01'], [80, '999901: Testkultur Sonderanbau'], [180, '2,0000 ha']],
      [[10, '2'], [30, 'DETHLIAL99999Z02'], [80, '111150: Winterweichweizen'], [180, '1,0000 ha']]
    ]);
    // Thüringen 2026 (KULTURART-Code), 999901 kennt die App nicht
    const F = [['ID', 'N', 10], ['FLAECHE_HA', 'N', 12, 4], ['SCHLAG', 'C', 10], ['ANTJAHR', 'C', 4], ['KULTURART', 'C', 10], ['FBI', 'C', 20]];
    const zeilen = [[1, '2.0000', '1', '2026', '999901', 'DETHLIAL99999Z01'], [2, '1.0000', '2', '2026', '111150', 'DETHLIAL99999Z02']];
    await ladeShapeZip(page, 'file-input', 'Antrag.zip', 'Antragsflächen Hauptnutzung_POLYGONE', F, zeilen, [rechteck(0), rechteck(1)],
      { 'Liste Hauptnutzungen.pdf': { base64: pdf.toString('base64') } });
    const kulturSpalte = async () => {
      const heads = await page.locator('#feature-table thead th').allInnerTexts();
      const i = heads.findIndex(h => h.trim() === 'Kulturart');
      if (i < 0) return [];
      return page.locator('#feature-table-body tr').evaluateAll((trs, i) => trs.map(tr => (tr.children[i] ? tr.children[i].textContent.trim() : '')), i);
    };
    await expect.poll(kulturSpalte, { timeout: 30000 }).toContain('Testkultur Sonderanbau');
    const gelernt = await page.evaluate(() => JSON.parse(localStorage.getItem('feldfolio-nutzungscodes') || '{}'));
    expect(gelernt.TH['999901']).toBe('Testkultur Sonderanbau');
    expect(gelernt.TH['111150']).toBeUndefined(); // schon bekannt -> nicht gelernt
  });
});
