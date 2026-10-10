import { test, expect } from '@playwright/test';
import { setupCloud, loginWithCloud } from './helpers.js';

// Zeiterfassung (src/zeiterfassung.js): Fahrt-, Kontroll- und Bürozeit, gestartet
// dort, wo gearbeitet wird (Route, Betriebsseite, Kontrollmappe), Anzeige in der
// Kopfzeile, Reiter "Zeiten" mit Wochenliste, Nachtragen und Excel.
// Die Uhr der Seite ist gestellt (Mittwoch, 07.10.2026, 08:00). Daten erfunden.
test.beforeEach(async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-07T08:00:00') });
  // "Route" öffnet Google Maps in einem neuen Tab — im Test nicht wirklich laden
  await context.route(/google\.[a-z]+\/maps/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Route</title>' }));
});

async function start(page) {
  await page.goto('/');
  await setupCloud(page, { workspaces: {} });
  await loginWithCloud(page);
  await page.locator('#kontrolle-switcher').click();
  return page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Hof Alpha', auditart: 'Jahresinspektion', date: new Date(), lat: 48.45, lng: 12.1, address: 'Hofweg 1' }));
}
const zeilen = (page) => page.locator('#ko-zeiten .ze-zeile').evaluateAll(els => els.map(el => [el.querySelector('.ze-zeile-zeit').textContent, el.querySelector('.ze-zeile-text b').textContent, el.querySelector('.ze-zeile-dauer').textContent].join(' | ')));
const zuDenZeiten = async (page) => {
  // ein zweiter Klick auf die schon aktive Kachel führte zurück zur Karte
  const imDashboard = await page.evaluate(() => document.body.dataset.view === 'kontrolle' && document.body.dataset.koBereich === 'dashboard');
  if (!imDashboard) await page.locator('#kontrolle-switcher').click();
  await page.locator('#kontrolle-tabs [data-ko-tab="zeiten"]').click();
};
const inDerCloud = (page) => page.evaluate(async () => { await window.__ffTestOffline.sync(); return window.__ffTestCloud.row.data.profil.zeiten || []; });

test.describe('Zeiterfassung', () => {
  test('Route -> Fahrtzeit, Betriebsseite -> „Angekommen“, Stoppen: Zeiten mit Betrieb, Summen, im Konto gespeichert', async ({ page }) => {
    const id = await start(page);
    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof Alpha'));
    await page.locator('#betrieb-switcher').click();
    const held = page.locator('.kb-hero-actions');
    await expect(held.locator('.ze-platz button')).toHaveText(/^timer\s*Kontrollzeit starten$/);
    await expect(page.locator('#ze-chip')).toBeHidden();

    // Tipp auf "Route": die App fragt nach der Fahrtzeit
    const [popup] = await Promise.all([page.waitForEvent('popup'), held.locator('a[data-ze-route]').click()]);
    await popup.close();
    await expect(page.locator('#ze-frage')).toBeVisible();
    await expect(page.locator('#ze-frage-text')).toHaveText('Fahrt zu Hof Alpha');
    await page.locator('#ze-frage [data-ze-akt="frage-ja"]').click();
    await expect(page.locator('#ze-frage')).toBeHidden();
    await expect(page.locator('#ze-chip')).toContainText('Fahrt');
    await page.clock.fastForward('30:00');
    await expect(page.locator('#ze-chip')).toContainText('0:30:0');

    // angekommen: Kontrollzeit starten beendet die Fahrt
    await expect(held.locator('.ze-platz button')).toContainText('Angekommen · Kontrollzeit starten');
    await held.locator('.ze-platz button').click();
    await expect(held.locator('.ze-platz button')).toContainText('Kontrolle läuft');
    await expect(page.locator('#ze-chip')).toContainText('Kontrolle');
    await page.clock.fastForward('01:30:00');
    await held.locator('.ze-platz button').click(); // stoppen
    await expect(page.locator('#ff-toast')).toHaveText('Kontrollzeit gestoppt: 1:30 h.');
    await expect(page.locator('#ze-chip')).toBeHidden();
    await expect(held.locator('.ze-platz button')).toContainText('Kontrollzeit starten');

    // Reiter "Zeiten"
    await zuDenZeiten(page);
    expect(await zeilen(page)).toEqual(['08:00–08:30 | Fahrt · Hof Alpha | 0:30 h', '08:30–10:00 | Kontrolle · Hof Alpha | 1:30 h']);
    await expect(page.locator('#ze-woche-text')).toContainText('KW 41');
    await expect(page.locator('#ze-summen-woche')).toContainText('Fahrt 0:30 h');
    await expect(page.locator('#ze-summen-woche')).toContainText('Kontrolle 1:30 h');
    await expect(page.locator('#ze-summen-woche')).toContainText('Gesamt 2:00 h');
    const cloud = await inDerCloud(page);
    expect(cloud.map(e => [e.art, e.betrieb, e.terminId, !!e.ende])).toEqual([['fahrt', 'Hof Alpha', id, true], ['kontrolle', 'Hof Alpha', id, true]]);
  });

  test('Kontrollmappe und Dashboard-Baustein: starten und stoppen', async ({ page }) => {
    await start(page);
    await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
    await page.locator('#kontrolle-tabs [data-ko-tab="uebersicht"]').click();
    await page.locator('#ko-agenda [data-open-termin]').first().click();
    const mappe = page.locator('#kontrollmappe .km-actions .ze-platz button');
    await mappe.click();
    await expect(mappe).toContainText('Kontrolle läuft');
    await page.clock.fastForward('45:00');
    await mappe.click();
    await expect(page.locator('#ff-toast')).toHaveText('Kontrollzeit gestoppt: 0:45 h.');
    await page.locator('#kontrollmappe-close').click();

    // Baustein: Bürozeit, Summen von heute
    await page.locator('#ko-dash-anpassen').click();
    await page.locator('.ko-w-neu[data-w="zeit"]').click();
    await page.locator('#ko-dash-anpassen').click();
    const baustein = page.locator('[data-w-id="zeit"]');
    await expect(baustein).toContainText('Gerade läuft keine Zeit.');
    await baustein.locator('[data-ze-art="buero"]').click();
    await expect(baustein.locator('.ze-jetzt')).toContainText('Büro');
    await expect(baustein.locator('.ze-start')).toHaveCount(0); // es läuft immer nur eine Zeit
    await page.clock.fastForward('15:00');
    await baustein.locator('[data-ze-akt="stopp"]').click();
    await expect(baustein.locator('.ze-summen').first()).toContainText('Kontrolle 0:45 h');
    await expect(baustein.locator('.ze-summen').first()).toContainText('Büro 0:15 h');
    await expect(baustein.locator('.ze-summen').first()).toContainText('Gesamt 1:00 h');
    await baustein.locator('[data-ko-tab="zeiten"]').click(); // "Alle Zeiten"
    await expect(page.locator('#kontrolle-zeiten')).toBeVisible();
    expect(await zeilen(page)).toHaveLength(2);
  });

  test('Nachtragen, ändern, löschen; über Mitternacht; Woche wechseln; Monat als Excel', async ({ page }) => {
    await start(page);
    await zuDenZeiten(page);
    await expect(page.locator('#ko-zeiten')).toContainText('In dieser Woche ist noch keine Zeit erfasst.');
    const speichern = () => page.locator('#ze-d-speichern').click();

    await page.locator('[data-ze-akt="nachtragen"]').click();
    await expect(page.locator('#ze-d-datum')).toHaveValue('2026-10-07');
    await speichern();
    await expect(page.locator('#ze-d-fehler')).toHaveText('Bitte Datum und Beginn angeben.');
    await page.locator('#ze-d-von').fill('06:00');
    await speichern();
    await expect(page.locator('#ze-d-fehler')).toHaveText('Bitte das Ende angeben.');
    await page.locator('#ze-d-bis').fill('07:15');
    await page.locator('#ze-d-art').selectOption('fahrt');
    await page.locator('#ze-d-betrieb').fill('Hof Beta');
    await page.locator('#ze-d-notiz').fill('Anfahrt über die Landstraße');
    await speichern();
    await expect(page.locator('#ze-dialog')).toBeHidden();
    expect(await zeilen(page)).toEqual(['06:00–07:15 | Fahrt · Hof Beta | 1:15 h']);
    await expect(page.locator('#ko-zeiten .ze-zeile small')).toHaveText('Anfahrt über die Landstraße');

    // ändern
    await page.locator('#ko-zeiten [data-ze-akt="bearbeiten"]').click();
    await expect(page.locator('#ze-d-titel')).toHaveText('Zeit ändern');
    await page.locator('#ze-d-bis').fill('07:30');
    await speichern();
    expect(await zeilen(page)).toEqual(['06:00–07:30 | Fahrt · Hof Beta | 1:30 h']);

    // über Mitternacht (gestern 23:00 bis 01:00)
    await page.locator('[data-ze-akt="nachtragen"]').click();
    await page.locator('#ze-d-datum').fill('2026-10-06');
    await page.locator('#ze-d-von').fill('23:00');
    await page.locator('#ze-d-bis').fill('01:00');
    await page.locator('#ze-d-art').selectOption('buero');
    await page.locator('#ze-d-betrieb').fill('');
    await speichern();
    expect(await zeilen(page)).toEqual(['23:00–01:00 | Büro | 2:00 h', '06:00–07:30 | Fahrt · Hof Beta | 1:30 h']);
    await expect(page.locator('#ko-zeiten .ze-tag')).toHaveCount(2);
    await expect(page.locator('#ze-summen-woche')).toContainText('Gesamt 3:30 h');

    // Excel für den Monat
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-ze-akt="excel"]').click()]);
    expect(download.suggestedFilename()).toBe('Zeiterfassung_2026-10.xlsx');

    // löschen
    page.once('dialog', d => d.accept());
    await page.locator('#ko-zeiten [data-ze-akt="bearbeiten"]').first().click();
    await page.locator('#ze-d-loeschen').click();
    expect(await zeilen(page)).toEqual(['06:00–07:30 | Fahrt · Hof Beta | 1:30 h']);

    // Woche wechseln
    await page.locator('[data-ze-akt="woche-zurueck"]').click();
    await expect(page.locator('#ze-woche-text')).toContainText('KW 40');
    await expect(page.locator('#ko-zeiten')).toContainText('In dieser Woche ist noch keine Zeit erfasst.');
    await page.locator('[data-ze-akt="woche-heute"]').click();
    expect(await zeilen(page)).toHaveLength(1);
  });

  test('Auf einem anderen Gerät gestartete Zeit läuft hier weiter; nach dem Abmelden ist sie weg', async ({ page }) => {
    await start(page);
    await page.evaluate(() => window.__ffTestOffline.sync());
    await page.evaluate(() => window.__ffTestCloud.setRemote(d => {
      d.profil = { ...(d.profil || {}), zeiten: [
        { id: 'fern', art: 'kontrolle', start: new Date(Date.now() - 20 * 60000).toISOString(), ende: null, betrieb: 'Hof Alpha' },
        { art: 'unsinn', start: 'kein Datum' }
      ] };
    }));
    await page.evaluate(() => window.__ffTestSync.ping());
    await expect(page.locator('#ze-chip')).toContainText('Kontrolle');
    await expect(page.locator('#ze-chip')).toContainText('0:20:');
    await page.locator('#ze-chip').click(); // führt zum Reiter "Zeiten"
    await expect(page.locator('#kontrolle-zeiten')).toBeVisible();
    expect(await zeilen(page)).toEqual(['07:40–läuft | Kontrolle · Hof Alpha | 0:20 h']);

    await page.locator('#btn-account').click();
    await page.locator('#account-menu-signout').click();
    await page.locator('#signout-confirm').click();
    await expect(page.locator('#btn-account')).not.toHaveClass(/logged-in/);
    await expect(page.locator('#ze-chip')).toBeHidden();
  });
});
