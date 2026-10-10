import { test, expect } from '@playwright/test';
import { gotoKontrolleKalender, openFirstTermin } from './helpers.js';

// Warenflussprüfung am Termin (src/warenfluss.js): Bereiche, Referenzwerte
// mit Quelle, Rechnung + Ampel, Toleranzen, Mengenbilanz, Freitext.

async function openNew(page, modul) {
  await page.goto('/');
  const id = await page.evaluate(() => { window.__ffTestTk.loginFake(); return window.__ffTestTk.addEvent({ kunde: 'Biohof Sonnental' }); });
  await gotoKontrolleKalender(page);
  await openFirstTermin(page, 'protokolle');
  await page.locator('#tk-warenfluss-new').click();
  await expect(page.locator('.wf-module-btn')).toHaveCount(7);
  await page.locator(`[data-wf-new="${modul}"]`).click();
  await expect(page.locator('#warenfluss-overlay')).toBeVisible();
  return id;
}
const sec = (page, key) => page.locator(`.wf-section[data-table="${key}"]`);
const stage = (page, n) => page.locator('.wf-stage').nth(n - 1);
const sf = (page, n, key) => stage(page, n).locator(`.wf-sfield[data-sfield="${key}"]`);
async function fillStage(page, n, values) {
  for (const [k, v] of Object.entries(values)) await sf(page, n, k).locator('input').fill(v);
}
const stored = (page, id) => page.evaluate((evId) => structuredClone(window.__ffTestTk.getEvent(evId).warenfluss || []), id);

test.describe('Warenflussprüfung', () => {
  test('Eingesehene Unterlagen ankreuzen: erscheinen im Prüftext und bleiben gespeichert', async ({ page }) => {
    const id = await openNew(page, 'pflanzenbau');
    const box = page.locator('#wf-docs .wf-docs-box');
    await expect(box).toHaveAttribute('open', '');
    await expect(page.locator('#wf-docs-count')).toHaveText('noch keine');
    await expect(page.locator('#wf-auto-text')).toContainText('Eingesehene Unterlagen: [ ]');
    await page.locator('.wf-doc', { hasText: 'Schlagkartei' }).locator('input').check();
    await page.locator('.wf-doc', { hasText: 'Saatgutbelege' }).locator('input').check();
    await page.locator('[data-wf-dok-sonst]').fill('Pachtverträge');
    await expect(page.locator('#wf-docs-count')).toHaveText('3 angekreuzt');
    await expect(page.locator('#wf-auto-text')).toContainText('Eingesehene Unterlagen: Schlagkartei, Saatgutbelege, Pachtverträge.');
    await page.locator('.wf-doc', { hasText: 'Saatgutbelege' }).locator('input').uncheck();
    await expect(page.locator('#wf-auto-text')).toContainText('Eingesehene Unterlagen: Schlagkartei, Pachtverträge.');
    await page.locator('#wf-done').click();
    const chk = (await stored(page, id))[0];
    expect(chk.dokumente).toEqual({ schlagkartei: true });
    expect(chk.dokumenteSonst).toBe('Pachtverträge');
    // Tierhaltung hat eigene Unterlagen
    await page.locator('#tk-warenfluss-new').click();
    await page.locator('[data-wf-new="tierhaltung"]').click();
    await expect(page.locator('.wf-doc', { hasText: 'Futtermittelbelege' })).toHaveCount(1);
    await expect(page.locator('.wf-doc', { hasText: 'Schlagkartei' })).toHaveCount(0);
  });

  test('Pflanzenbau: Referenz mit Quelle, Ertrag je ha mit Ampel, Saatgut, Toleranz', async ({ page }) => {
    const id = await openNew(page, 'pflanzenbau');
    await expect(page.locator('#wf-title')).toHaveText('Warenflussprüfung · Pflanzenbau');
    await expect(page.locator('#wf-sub')).toContainText('Biohof Sonnental');

    const ertrag = sec(page, 'ertrag');
    await ertrag.locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await expect(ertrag.locator('[data-field="refTyp"]').first()).toHaveValue('41,2');
    await expect(ertrag.locator('.wf-src').first()).toHaveText('LfL Bayern 2026');
    await expect(ertrag.locator('.wf-src').first()).toHaveAttribute('href', /stmelf\.bayern\.de/);
    await ertrag.locator('[data-field="flaeche"]').first().fill('12,5');
    await ertrag.locator('[data-field="ernte"]').first().fill('540');
    await expect(ertrag.locator('[data-calc="ertragHa"]').first()).toContainText('43,2');
    await expect(ertrag.locator('[data-calc="erwartet"]').first()).toContainText('515');
    await expect(ertrag.locator('.wf-status').first()).toHaveClass(/is-ok/);

    // Zweite Kultur, deutlich zu hoch -> auffällig
    await ertrag.locator('[data-add-row]').click();
    await ertrag.locator('select[data-field="kultur"]').nth(1).selectOption('ackerbohne');
    await ertrag.locator('[data-field="flaeche"]').nth(1).fill('6');
    await ertrag.locator('[data-field="ernte"]').nth(1).fill('210');
    await expect(ertrag.locator('tbody .wf-status').nth(1)).toHaveClass(/is-bad/);
    await expect(ertrag.locator('tfoot')).toContainText('18,5 ha');
    await expect(page.locator('#wf-summary')).toContainText('1 auffällig');
    // Referenz überschreiben (z. B. Standort mit höherem Niveau) -> plausibel
    await ertrag.locator('[data-field="refTyp"]').nth(1).fill('33');
    await expect(ertrag.locator('tbody .wf-status').nth(1)).toHaveClass(/is-ok/);
    // Toleranz verkleinern: 43,2 vs. 41,2 dt/ha = +4,9 % liegt bei ±4 % im Prüfbereich (bis 1,5 × 4 = 6 %)
    await page.locator('#wf-tol-ertrag').fill('4');
    await expect(sec(page, 'ertrag').locator('tbody .wf-status').first()).toHaveClass(/is-warn/);
    await page.locator('#wf-tol-ertrag').fill('25');

    // Saatgut: Bedarf aus Saatstärke × TKM, Annahme gekennzeichnet in der Info
    const saat = sec(page, 'saat');
    await saat.locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await expect(saat.locator('[data-field="refTyp"]').first()).toHaveValue('169');
    await expect(saat.locator('.wf-src').first()).toHaveAttribute('title', /TKM 45 g \(Annahme\)/);
    await saat.locator('[data-field="flaeche"]').first().fill('12,5');
    await saat.locator('[data-field="eingesetzt"]').first().fill('2300');
    await expect(saat.locator('[data-calc="jeHa"]').first()).toContainText('184');
    await expect(saat.locator('.wf-status').first()).toHaveClass(/is-ok/);

    // Gespeichert am Termin
    const list = await stored(page, id);
    expect(list).toHaveLength(1);
    expect(list[0].modul).toBe('pflanzenbau');
    expect(list[0].tables.ertrag[0]).toMatchObject({ kultur: 'winterweizen', flaeche: 12.5, ernte: 540 });
  });

  test('Mengenbilanz: Soll-Endbestand, Differenz und Bilanz-Toleranz', async ({ page }) => {
    await openNew(page, 'pflanzenbau');
    await page.locator('[data-wf-bilanz="on"]').click();
    const b = sec(page, 'bilanz');
    await b.locator('[data-field="produkt"]').first().fill('Winterweizen');
    for (const [f, v] of [['anfang', '35'], ['zugang', '540'], ['verkauf', '480'], ['sonst', '30'], ['ende', '62']]) {
      await b.locator(`[data-field="${f}"]`).first().fill(v);
    }
    await expect(b.locator('[data-calc="soll"]').first()).toContainText('65');
    await expect(b.locator('[data-calc="diff"]').first()).toContainText('-3');
    await expect(b.locator('.wf-status').first()).toHaveClass(/is-ok/); // -0,5 % < 2 %
    await b.locator('[data-field="ende"]').first().fill('40');
    await expect(b.locator('.wf-status').first()).toHaveClass(/is-bad/); // -25 dt = -4,3 %
  });

  test('Freitext: vorformuliert aus der Tabelle, bearbeitbar, neu erzeugbar', async ({ page }) => {
    await openNew(page, 'pflanzenbau');
    await sec(page, 'ertrag').locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await sec(page, 'ertrag').locator('[data-field="flaeche"]').first().fill('10');
    await sec(page, 'ertrag').locator('[data-field="ernte"]').first().fill('420');
    await page.locator('#wf-mode [data-mode="text"]').click();
    const ta = page.locator('#wf-text');
    await expect(ta).toBeVisible();
    await expect(ta).toHaveValue(/Warenflussprüfung Pflanzenbau — Biohof Sonnental/);
    await expect(ta).toHaveValue(/Winterweizen: 10 ha, Ernte 420 dt = 42 dt\/ha; Referenz 41,2 dt\/ha \(LfL Bayern 2026\) → plausibel/);
    await expect(ta).toHaveValue(/Grundlagen der Prüfung: Flächennachweis/);
    await expect(ta).toHaveValue(/Erläuterung des Betriebs: \[ \]/);
    // bearbeiten bleibt erhalten
    await ta.fill('Eigener Text');
    await page.locator('#wf-mode [data-mode="tabelle"]').click();
    await page.locator('#wf-mode [data-mode="text"]').click();
    await expect(ta).toHaveValue('Eigener Text');
    page.once('dialog', d => d.accept());
    await page.locator('#wf-text-regen').click();
    await expect(ta).toHaveValue(/Warenflussprüfung Pflanzenbau/);
  });

  test('Tierhaltung, Imkerei, Verarbeitung, Handel rechnen mit ihren Referenzen', async ({ page }) => {
    await openNew(page, 'tierhaltung');
    const l = sec(page, 'leistung');
    await l.locator('select[data-field="tierart"]').first().selectOption('legehenne');
    await expect(l.locator('[data-field="refTyp"]').first()).toHaveValue('290');
    await expect(l.locator('.wf-numcell .wf-unit').first()).toHaveText('Ø Hennen');
    await l.locator('[data-field="anzahl"]').first().fill('3000');
    await l.locator('[data-field="angegeben"]').first().fill('840000');
    await expect(l.locator('[data-calc="jeTier"]').first()).toContainText('280');
    await expect(l.locator('.wf-status').first()).toHaveClass(/is-ok/);
    const f = sec(page, 'futter');
    await f.locator('select[data-field="tierart"]').first().selectOption('milchkuh');
    await f.locator('[data-field="anzahl"]').first().fill('40');
    await expect(f.locator('[data-calc="bedarf"]').first()).toContainText('76.080');
    await page.locator('#wf-done').click();

    // Imkerei
    await page.locator('#tk-warenfluss-new').click();
    await page.locator('[data-wf-new="imkerei"]').click();
    const h = sec(page, 'honig');
    await expect(h.locator('[data-field="refTyp"]').first()).toHaveValue('34,2');
    await h.locator('[data-field="voelker"]').first().fill('20');
    await h.locator('[data-field="geerntet"]').first().fill('1400');
    await expect(h.locator('.wf-status').first()).toHaveClass(/is-bad/); // 70 kg/Volk
    await page.locator('#wf-done').click();

    // Verarbeitung: Dinkel entspelzen
    await page.locator('#tk-warenfluss-new').click();
    await page.locator('[data-wf-new="verarbeitung"]').click();
    const a = sec(page, 'ausbeute');
    await a.locator('select[data-field="prozess"]').first().selectOption('dinkel-entspelzen');
    await a.locator('[data-field="einsatz"]').first().fill('10000');
    await expect(a.locator('[data-calc="erwartet"]').first()).toContainText('6.500');
    await a.locator('[data-field="erzeugt"]').first().fill('6700');
    await expect(a.locator('.wf-status').first()).toHaveClass(/is-ok/);
    await page.locator('#wf-done').click();

    // Handel: nur Mengenbilanz, ohne Spalte "Erzeugung"
    await page.locator('#tk-warenfluss-new').click();
    await page.locator('[data-wf-new="handel"]').click();
    await expect(page.locator('.wf-section')).toHaveCount(1);
    await expect(sec(page, 'bilanz').locator('[data-field="zugang"]')).toHaveCount(0);
    await page.locator('#wf-done').click();

    // Liste im Termin mit vier Prüfungen und Zähler am Reiter
    await expect(page.locator('#tk-warenfluss-list .wf-list-row')).toHaveCount(4);
    await expect(page.locator('#kontrollmappe [data-km-tab="protokolle"] .km-tab-count')).toHaveText('4');
    await expect(page.locator('#tk-warenfluss-list')).toContainText('Imkerei');
  });

  test('Prüftext entsteht automatisch aus der Berechnung und folgt jeder Änderung', async ({ page }) => {
    await openNew(page, 'pflanzenbau');
    const auto = page.locator('#wf-auto-text');
    await expect(page.locator('#wf-auto')).toBeVisible();
    await expect(auto).toContainText('[nicht geprüft / keine Angaben]');

    const e = sec(page, 'ertrag');
    await e.locator('select[data-field="kultur"]').first().selectOption('ackerbohne');
    await e.locator('[data-field="flaeche"]').first().fill('6');
    await e.locator('[data-field="ernte"]').first().fill('210');
    // Zusammenfassung, Befund mit Richtung und Ursachen, Klärungspunkt, Ergebnis
    await expect(auto).toContainText('Geprüft wurden 1 Kultur auf zusammen 6 ha');
    await expect(auto.locator('.wf-auto-befund')).toContainText('Ackerbohne: Der Ertrag von 35 dt/ha liegt 79 % über dem Referenzwert (19,6 dt/ha, LfL Bayern 2026) — auffällig. Mögliche Ursachen: nicht deklarierter Zukauf');
    await expect(auto.locator('.wf-auto-klaerung')).toContainText('1. Ackerbohne: Erläuterung des hohen Ertrags (35 dt/ha)');
    await expect(auto).toContainText('Der Warenfluss ist auf Grundlage der vorgelegten Unterlagen nicht plausibel');
    await expect(auto).toContainText('LfL Bayern – Deckungsbeiträge');

    // Bilanz mit Mehrmenge -> eigener Befund
    await page.locator('[data-wf-bilanz="on"]').click();
    const b = sec(page, 'bilanz');
    await b.locator('[data-field="produkt"]').first().fill('Ackerbohne');
    for (const [k, v] of [['anfang', '0'], ['zugang', '210'], ['verkauf', '150'], ['ende', '80']]) await b.locator(`[data-field="${k}"]`).first().fill(v);
    await expect(auto).toContainText('Der Inventurbestand liegt um 20 dt');
    await expect(auto).toContainText('Herkunft der Mehrmenge von 20 dt mit Belegen nachweisen');

    // Werte korrigiert -> Text wird plausibel, ohne Befunde
    await e.locator('[data-field="ernte"]').first().fill('120');
    await b.locator('[data-field="ende"]').first().fill('60');
    await b.locator('[data-field="zugang"]').first().fill('120');
    await b.locator('[data-field="verkauf"]').first().fill('60');
    await expect(auto).toContainText('Der Warenfluss ist plausibel. Alle 2 geprüften Werte liegen innerhalb der Toleranzen');
    await expect(auto.locator('.wf-auto-befund')).toHaveCount(0);
  });

  test('Freitext folgt automatisch, bis er bearbeitet wird — danach Hinweis bei Tabellenänderungen', async ({ page }) => {
    await openNew(page, 'pflanzenbau');
    const e = sec(page, 'ertrag');
    await e.locator('select[data-field="kultur"]').first().selectOption('winterweizen');
    await e.locator('[data-field="flaeche"]').first().fill('10');
    await e.locator('[data-field="ernte"]').first().fill('420');
    await page.locator('#wf-auto-edit').click();
    const ta = page.locator('#wf-text');
    await expect(ta).toBeFocused();
    await expect(ta).toHaveValue(/42 dt\/ha/);
    // unbearbeitet: Tabellenänderung kommt automatisch an
    await page.locator('#wf-mode [data-mode="tabelle"]').click();
    await e.locator('[data-field="ernte"]').first().fill('450');
    await page.locator('#wf-mode [data-mode="text"]').click();
    await expect(ta).toHaveValue(/45 dt\/ha/);
    await expect(page.locator('#wf-text-stale')).toBeHidden();
    // bearbeitet: bleibt stehen, Hinweis erscheint nach Tabellenänderung
    await ta.fill('Mein eigener Bericht');
    await page.locator('#wf-mode [data-mode="tabelle"]').click();
    await e.locator('[data-field="ernte"]').first().fill('400');
    await page.locator('#wf-mode [data-mode="text"]').click();
    await expect(ta).toHaveValue('Mein eigener Bericht');
    await expect(page.locator('#wf-text-stale')).toBeVisible();
    page.once('dialog', d => d.accept());
    await page.locator('#wf-text-stale-update').click();
    await expect(ta).toHaveValue(/40 dt\/ha/);
    await expect(page.locator('#wf-text-stale')).toBeHidden();
  });

  test('Verarbeitung: Branchen (Bäckerei, Kaffeerösterei, Brauerei …), enge Toleranz', async ({ page }) => {
    await openNew(page, 'verarbeitung');
    await expect(page.locator('#wf-tol-ertrag')).toHaveValue('5');
    const a = sec(page, 'ausbeute');
    const groups = await a.locator('select[data-field="prozess"] optgroup').evaluateAll(gs => gs.map(g => g.label));
    for (const g of ['Mühle / Schälmühle', 'Bäckerei', 'Mälzerei / Brauerei', 'Kaffeerösterei', 'Molkerei / Käserei', 'Obst / Wein', 'Soja / Tofu', 'Metzgerei']) expect(groups).toContain(g);

    await a.locator('select[data-field="prozess"]').first().selectOption('kaffee');
    await expect(a.locator('.wf-src').first()).toHaveText('KaffeeWiki');
    await a.locator('[data-field="einsatz"]').first().fill('1200');
    await a.locator('[data-field="erzeugt"]').first().fill('1000');
    await expect(a.locator('.wf-status').first()).toHaveClass(/is-ok/); // 0,833
    await a.locator('[data-field="erzeugt"]').first().fill('1150');
    await expect(a.locator('.wf-status').first()).toHaveClass(/is-bad/); // 0,958 — kaum Röstverlust
    await expect(page.locator('#wf-auto-text')).toContainText('Nicht belegter (ggf. nicht ökologischer) Rohwarenzukauf ist auszuschließen');

    await a.locator('[data-add-row]').click();
    await a.locator('select[data-field="prozess"]').nth(1).selectOption('kleingebaeck');
    await a.locator('[data-field="einsatz"]').nth(1).fill('2000');
    await expect(a.locator('[data-calc="erwartet"]').nth(1)).toContainText('2.520');
    await a.locator('[data-add-row]').click();
    await a.locator('select[data-field="prozess"]').nth(2).selectOption('bier');
    await a.locator('[data-field="einsatz"]').nth(2).fill('170');
    await expect(a.locator('[data-calc="erwartet"]').nth(2)).toContainText('999,6');
  });

  test('Mengenbilanz ist optional: standardmäßig aus, ein-/ausblendbar, Werte bleiben erhalten', async ({ page }) => {
    const id = await openNew(page, 'pflanzenbau');
    await expect(sec(page, 'ertrag')).toBeVisible();
    await expect(sec(page, 'bilanz')).toHaveCount(0);
    await expect(page.locator('#wf-tol-bilanz-wrap')).toBeHidden();
    const auto = page.locator('#wf-auto-text');
    await expect(auto).not.toContainText('Mengenbilanz');
    // Mängel-/Nachweis-Zeilen gibt es im Prüftext nicht mehr
    await expect(auto).not.toContainText('Festgestellte Mängel');
    await expect(auto).not.toContainText('Nachweise nachzureichen');

    await page.locator('[data-wf-bilanz="on"]').click();
    await expect(page.locator('#wf-tol-bilanz-wrap')).toBeVisible();
    const b = sec(page, 'bilanz');
    await b.locator('[data-field="produkt"]').first().fill('Weizen');
    await b.locator('[data-field="zugang"]').first().fill('100');
    await b.locator('[data-field="ende"]').first().fill('100');
    await expect(auto).toContainText('Mengenbilanz (Warenfluss)');
    await b.locator('[data-wf-bilanz="off"]').click();
    await expect(sec(page, 'bilanz')).toHaveCount(0);
    await expect(auto).not.toContainText('Mengenbilanz');
    const list = await stored(page, id);
    expect(list[0].mitBilanz).toBe(false);
    expect(list[0].tables.bilanz[0]).toMatchObject({ produkt: 'Weizen', zugang: 100 });
    // Handel: Bilanz ist dort Pflicht und nicht ausblendbar
    await page.locator('#wf-done').click();
    await page.locator('#tk-warenfluss-new').click();
    await page.locator('[data-wf-new="handel"]').click();
    await expect(sec(page, 'bilanz')).toBeVisible();
    await expect(page.locator('[data-wf-bilanz]')).toHaveCount(0);
  });

  test('Warenflusskette: Erzeuger und Molkerei (Milch → Käse, Verzweigung Butter), Verbleib je Stufe', async ({ page }) => {
    const id = await openNew(page, 'kette');
    await expect(page.locator('#wf-title')).toHaveText('Warenflussprüfung · Warenflusskette');
    await expect(page.locator('#wf-tol-ausbeute-wrap')).toBeVisible();
    await expect(page.locator('#wf-tol-ausbeute')).toHaveValue('5');
    await expect(page.locator('.wf-stage')).toHaveCount(2);

    // Stufe 1: Milchkühe -> Milch
    await stage(page, 1).locator('[data-field="refKey"]').selectOption('milchkuh');
    await expect(stage(page, 1).locator('[data-sf="produkt"]')).toHaveValue('Milch');
    await expect(sf(page, 1, 'refTyp').locator('input')).toHaveValue('7049');
    await fillStage(page, 1, { basis: '50', erzeugt: '350000' });
    await expect(sf(page, 1, 'status').locator('.wf-status')).toHaveClass(/is-ok/);

    // Stufe 2: Milch -> Schnittkäse, Rohware aus Stufe 1
    await expect(stage(page, 2).locator('[data-sf="quelleId"]')).toHaveValue(await stage(page, 1).getAttribute('data-stufe'));
    await stage(page, 2).locator('[data-field="refKey"]').selectOption('schnittkaese');
    await expect(stage(page, 2).locator('[data-sf="produkt"]')).toHaveValue('Schnittkäse');
    await expect(stage(page, 2).locator('.wf-stage-warn')).toContainText('1 l Milch ≈ 1,03 kg');
    await fillStage(page, 2, { basis: '340000', erzeugt: '34000', verkauf: '33000', ende: '1000' });
    await expect(sf(page, 2, 'status').locator('.wf-status')).toHaveClass(/is-ok/);
    await expect(sf(page, 2, 'bilanz').locator('.wf-status')).toHaveClass(/is-ok/);

    // Verbleib Stufe 1: Einsatz der Molkerei zählt als Abgang "an Folgestufe(n)"
    await expect(sf(page, 1, 'weiter')).toContainText('340.000');
    await fillStage(page, 1, { verkauf: '8000', ende: '2000' });
    await expect(sf(page, 1, 'diff')).toContainText('0');
    await expect(sf(page, 1, 'bilanz').locator('.wf-status')).toHaveClass(/is-ok/);

    // Flussbild
    const flow = page.locator('#wf-flow');
    await expect(flow.locator('.wf-flow-node')).toHaveCount(3);
    await expect(flow).toContainText('Milch');
    await expect(flow).toContainText('Schnittkäse');
    await expect(flow).toContainText('Verkauf');

    // Verzweigung: Stufe 3 Butter ebenfalls aus der Milch
    await page.locator('[data-stufe-add]').click();
    await expect(page.locator('.wf-stage')).toHaveCount(3);
    await stage(page, 3).locator('[data-field="refKey"]').selectOption('butter');
    await stage(page, 3).locator('[data-sf="quelleId"]').selectOption({ label: 'Stufe 1 (Milch)' });
    await fillStage(page, 3, { basis: '20000' });
    await expect(sf(page, 1, 'weiter')).toContainText('360.000');
    await expect(sf(page, 1, 'bilanz').locator('.wf-status')).toHaveClass(/is-bad/); // Molkerei setzt 20.000 kg mehr ein als verfügbar (5,7 %)
    await expect(flow).toContainText('aus Stufe 1');

    const auto = page.locator('#wf-auto-text');
    await expect(auto).toContainText('Warenfluss: Milch → Schnittkäse → Butter (aus Stufe 1) → Verkauf');
    await expect(auto).toContainText('an Stufe 2 (Schnittkäse) und Stufe 3 (Butter) 360.000 kg');
    await expect(auto.locator('.wf-auto-befund')).toContainText('Stufe 1 (Milch): Der Inventurbestand liegt um 20.000 kg (5,7 %) über dem rechnerischen Bestand');

    const list = await stored(page, id);
    expect(list[0].modul).toBe('kette');
    expect(list[0].stufen.map(x => x.produkt)).toEqual(['Milch', 'Schnittkäse', 'Butter']);
  });

  test('Warenflusskette in einem Bereich: Karkassen (Zukauf) → Hühnerbrühe → Verkauf', async ({ page }) => {
    await openNew(page, 'kette');
    await stage(page, 1).locator('[data-sf="art"]').selectOption('ware');
    await stage(page, 1).locator('[data-sf="produkt"]').fill('Karkassen');
    await expect(stage(page, 1).locator('.wf-sfield[data-sfield="erzeugt"]')).toHaveCount(0);
    await fillStage(page, 1, { zukauf: '1000', ende: '50' });

    await stage(page, 2).locator('[data-field="refKey"]').selectOption('sonstige');
    await stage(page, 2).locator('[data-sf="produkt"]').fill('Hühnerbrühe');
    await stage(page, 2).locator('[data-sf="einheit"]').selectOption('l');
    await expect(stage(page, 2).locator('[data-sf="quelleId"] option:checked')).toHaveText('Stufe 1 (Karkassen)');
    await expect(stage(page, 2).locator('.wf-stage-warn')).toHaveCount(0);
    // eigene Ausbeute (Rezeptur) als Referenz
    await fillStage(page, 2, { basis: '950', refTyp: '2,5', erzeugt: '2300', verkauf: '2200', ende: '100' });
    await expect(sf(page, 2, 'erwartet')).toContainText('2.375');
    await expect(sf(page, 2, 'status').locator('.wf-status')).toHaveClass(/is-ok/); // 2,42 vs 2,5 = −3 %
    await expect(sf(page, 1, 'bilanz').locator('.wf-status')).toHaveClass(/is-ok/);
    await expect(sf(page, 2, 'bilanz').locator('.wf-status')).toHaveClass(/is-ok/);
    await expect(page.locator('#wf-flow')).toContainText('Hühnerbrühe');
    await expect(page.locator('#wf-flow .is-end')).toContainText('Hühnerbrühe 2.200 l');
    const auto = page.locator('#wf-auto-text');
    await expect(auto).toContainText('Warenfluss: Karkassen → Hühnerbrühe → Verkauf');
    await expect(auto).toContainText('Der Warenfluss ist plausibel');

    // weniger Einsatz in der Brühe -> bei den Karkassen bleibt ein Rest, der nicht in der Inventur steht
    await fillStage(page, 2, { basis: '900' });
    await expect(sf(page, 1, 'bilanz').locator('.wf-status')).toHaveClass(/is-bad/);
    await expect(auto.locator('.wf-auto-befund')).toContainText('Stufe 1 (Karkassen): Gegenüber dem rechnerischen Bestand fehlen 50 kg');

    // Mengenbilanz ausblenden: Zukauf-Stufe behält ihren Verbleib, Verarbeitung nicht
    await page.locator('[data-wf-bilanz="off"]').click();
    await expect(sf(page, 1, 'bilanz')).toHaveCount(1);
    await expect(sf(page, 2, 'bilanz')).toHaveCount(0);
    await expect(page.locator('[data-wf-bilanz="on"]')).toBeVisible();

    // Stufe entfernen (mit Rückfrage)
    page.once('dialog', d => d.accept());
    await stage(page, 2).locator('[data-stufe-del]').click();
    await expect(page.locator('.wf-stage')).toHaveCount(1);
  });

  test('Warenflussprüfung in der Liste löschen — nur nach Bestätigung', async ({ page }) => {
    const id = await openNew(page, 'imkerei');
    await page.locator('#wf-done').click();
    const rows = page.locator('#tk-warenfluss-list .wf-list-row');
    await expect(rows).toHaveCount(1);
    page.once('dialog', d => { expect(d.message()).toContain('Imkerei'); d.dismiss(); });
    await rows.first().locator('[data-wf-del]').click();
    await expect(rows).toHaveCount(1);
    page.once('dialog', d => d.accept());
    await rows.first().locator('[data-wf-del]').click();
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#tk-warenfluss-list')).toContainText('Noch keine Warenflussprüfung');
    expect(await stored(page, id)).toHaveLength(0);
  });

  test('Zeitraum per Kalender: Schnellwahl, Von/Bis, Text bleibt synchron', async ({ page }) => {
    const id = await openNew(page, 'pflanzenbau');
    const y = new Date().getFullYear();
    const wj = `${y - 2}/${String(y - 1).slice(2)}`;
    const txt = page.locator('#wf-zeitraum');
    await expect(txt).toHaveValue(String(y - 1));
    const pop = page.locator('#wf-zeitraum-pop');
    await expect(pop).toBeHidden();
    await page.locator('#wf-zeitraum-cal').click();
    await expect(pop).toBeVisible();
    // Vorbelegung aus dem Text (Vorjahr = ganzes Kalenderjahr)
    await expect(page.locator('#wf-zr-von')).toHaveValue(`${y - 1}-01-01`);
    await expect(page.locator('#wf-zr-bis')).toHaveValue(`${y - 1}-12-31`);
    await expect(page.locator('.wf-zr-chip[aria-pressed="true"]')).toHaveText(`Kalenderjahr ${y - 1}`);

    // Schnellwahl Wirtschaftsjahr
    await page.locator('.wf-zr-chip', { hasText: `WJ ${y - 1}/` }).click();
    await expect(txt).toHaveValue(`01.07.${y - 1}–30.06.${y}`);
    await expect(page.locator('#wf-zr-von')).toHaveValue(`${y - 1}-07-01`);

    // Von/Bis frei wählen
    await page.locator('#wf-zr-von').fill(`${y - 1}-03-15`);
    await page.locator('#wf-zr-bis').fill(`${y - 1}-10-31`);
    await expect(txt).toHaveValue(`15.03.${y - 1}–31.10.${y - 1}`);
    // Bis vor Von -> Hinweis, Text bleibt
    await page.locator('#wf-zr-bis').fill(`${y - 1}-01-01`);
    await expect(page.locator('#wf-zr-hint')).toBeVisible();
    await expect(txt).toHaveValue(`15.03.${y - 1}–31.10.${y - 1}`);

    // Escape schließt nur die Auswahl, die Prüfung bleibt offen
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await expect(page.locator('#warenfluss-overlay')).toBeVisible();

    // Text eintippen -> Kalender folgt
    await txt.fill(wj);
    await page.locator('#wf-zeitraum-cal').click();
    await expect(page.locator('#wf-zr-von')).toHaveValue(`${y - 2}-07-01`);
    await expect(page.locator('#wf-zr-bis')).toHaveValue(`${y - 1}-06-30`);
    await page.locator('#wf-zr-done').click();
    await expect(pop).toBeHidden();

    // gespeichert und im Prüftext
    const list = await stored(page, id);
    expect(list[0]).toMatchObject({ zeitraum: wj, zeitraumVon: `${y - 2}-07-01`, zeitraumBis: `${y - 1}-06-30` });
    await expect(page.locator('#wf-auto-text')).toContainText(`Zeitraum: ${wj}`);
  });

  test('Pflanzenbau: Saatgut steht vor der Ernte — in der Tabelle und im Prüftext', async ({ page }) => {
    await openNew(page, 'pflanzenbau');
    await expect(page.locator('.wf-section[data-table] h4')).toHaveText(['Saat- und Pflanzgut', 'Ernte und Ertrag je Hektar']);
    const text = await page.locator('#wf-auto-text').innerText();
    expect(text.indexOf('Saat- und Pflanzgut')).toBeGreaterThan(-1);
    expect(text.indexOf('Saat- und Pflanzgut')).toBeLessThan(text.indexOf('Ernte und Ertrag je Hektar'));
  });

  test('Prüfung wieder öffnen und löschen', async ({ page }) => {
    const id = await openNew(page, 'handel');
    await sec(page, 'bilanz').locator('[data-field="produkt"]').first().fill('Bio-Haferflocken');
    await page.keyboard.press('Escape');
    await expect(page.locator('#warenfluss-overlay')).toBeHidden();
    await expect(page.locator('#kontrollmappe')).toBeVisible();
    await page.locator('#tk-warenfluss-list [data-wf-open]').first().click();
    await expect(sec(page, 'bilanz').locator('[data-field="produkt"]').first()).toHaveValue('Bio-Haferflocken');
    page.once('dialog', d => d.accept());
    await page.locator('#wf-delete').click();
    await expect(page.locator('#warenfluss-overlay')).toBeHidden();
    expect(await stored(page, id)).toHaveLength(0);
    await expect(page.locator('#tk-warenfluss-list .wf-list-row')).toHaveCount(0);
  });
});
