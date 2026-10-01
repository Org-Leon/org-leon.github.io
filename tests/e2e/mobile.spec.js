import { test, expect } from '@playwright/test';

// Handy-Layout der übrigen App (≤ 860 px, Touch): Kopfzeile, Zeichnen auf der
// Karte mit Fertig/Letzter Punkt, Setz-Chip, Kontrolle (Kalender als Tagesliste),
// Web-App installieren. Eigener Viewport wie stallplaner-vorort.spec.js.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function openFunction(page, view) {
  await page.locator('#btn-sidebar-toggle').click();
  await page.locator(`.segment-btn[data-view="${view}"]`).click();
}

test.describe('Handy-Ansicht', () => {
  test('Kopfzeile läuft nicht über und zeigt Funktion + Betrieb', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake('sehr.lange.adresse@beispiel-betrieb.de'));
    const tabbar = page.locator('#tabbar');
    const [scrollW, clientW] = await tabbar.evaluate(el => [el.scrollWidth, el.clientWidth]);
    expect(scrollW).toBeLessThanOrEqual(clientW);
    await expect(page.locator('#current-view-title')).toHaveText('Karte');
    // Unter 600 px zeigt der Betriebs-Chip nur Avatar bzw. Symbol.
    await expect(page.locator('#btn-betrieb')).toBeVisible();
    await expect(page.locator('#btn-betrieb .btn-betrieb-name')).toBeHidden();
    // Die E-Mail steht nicht mehr sichtbar im Konto-Button, nur im Tooltip.
    await expect(page.locator('#btn-account-label')).toBeHidden();

    await openFunction(page, 'zeichner');
    await expect(page.locator('#current-view-title')).toHaveText('Flächenzeichner');
    await expect(page.locator('body')).not.toHaveClass(/sidebar-open/);
    // Tipp auf den Titel öffnet die Schublade.
    await page.locator('#btn-current-view').click();
    await expect(page.locator('body')).toHaveClass(/sidebar-open/);
  });

  test('Flächenzeichner: Punkte antippen, „Letzter Punkt" und „Fertig" ohne Doppelklick', async ({ page }) => {
    await page.goto('/');
    await openFunction(page, 'zeichner');
    await page.locator('#shape-tool-draw').tap();
    await expect(page.locator('#map-draw-actions')).toBeVisible();
    await expect(page.locator('#map-draw-finish')).toBeDisabled();

    const vertices = page.locator('.leaflet-marker-icon.leaflet-editing-icon');
    const taps = [[90, 300], [300, 300], [300, 520], [90, 520]];
    for (let i = 0; i < taps.length; i++) {
      await page.touchscreen.tap(taps[i][0], taps[i][1]);
      await expect(vertices).toHaveCount(i + 1);
      // Menschliches Tipptempo — zwei schnelle Taps wertet der Browser als
      // Doppeltipp (Leaflet.draw: Fläche abschließen).
      await page.waitForTimeout(400);
    }
    await page.locator('#map-draw-undo').tap();
    await expect(vertices).toHaveCount(3);

    await page.locator('#map-draw-finish').tap();
    await expect(page.locator('#map-draw-actions')).toBeHidden();
    await expect(page.locator('#zeichner-list .parcel-item')).toHaveCount(1);
  });

  test('Obstart wählen schließt die Schublade, Chip auf der Karte beendet das Setzen', async ({ page }) => {
    await page.goto('/');
    await openFunction(page, 'obstbaum');
    await page.locator('#btn-sidebar-toggle').click();
    await page.locator('.fruit-btn').first().click();
    await expect(page.locator('body')).not.toHaveClass(/sidebar-open/);
    await expect(page.locator('#map-place-chip')).toBeVisible();
    await expect(page.locator('#map-place-chip-text')).toContainText('auf die Karte tippen');

    await page.locator('#map-place-chip-done').tap();
    await expect(page.locator('#map-place-chip')).toBeHidden();
    await expect(page.locator('.fruit-btn.active')).toHaveCount(0);
  });

  test('Kontrolle/Kalender: Tagesliste ohne seitliches Scrollen, Termin per Datumsfeld verschieben', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await openFunction(page, 'kontrolle');
    await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').tap();
    const id = await page.evaluate(() => window.__ffTestTk.addEvent({ kunde: 'Hof Mobil' }));

    const [scrollW, clientW] = await page.locator('#terminkalender-main')
      .evaluate(el => [el.scrollWidth, el.clientWidth]);
    expect(scrollW).toBeLessThanOrEqual(clientW);
    const cols = await page.locator('.tk-day-col').evaluateAll(els => els.map(e => e.getBoundingClientRect().width));
    expect(cols).toHaveLength(7);
    cols.forEach(w => expect(w).toBeGreaterThan(300));

    await page.locator('.tk-card', { hasText: 'Hof Mobil' }).tap();
    const moveInput = page.locator('#tk-move-date');
    await expect(moveInput).toBeInViewport();

    const target = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 10);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await moveInput.fill(target);
    const moved = await page.evaluate((evId) => {
      const d = window.__ffTestTk.getEvent(evId).date;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }, id);
    expect(moved).toBe(target);
    // Kontrollmappe schließen: die Liste ist in die Woche des neuen Datums gesprungen.
    await page.locator('#kontrollmappe-close').tap();
    await expect(page.locator('#kontrollmappe')).toBeHidden();
    await expect(page.locator('.tk-card', { hasText: 'Hof Mobil' })).toBeVisible();
  });

  test('„App installieren" erscheint nach beforeinstallprompt und öffnet den System-Dialog', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-install-app')).toBeHidden();
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => { window.__installPrompted = true; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#btn-install-app')).toBeVisible();
    await page.locator('#btn-install-app').click();
    expect(await page.evaluate(() => window.__installPrompted)).toBe(true);
    await expect(page.locator('#btn-install-app')).toBeHidden();
  });
});

test.describe('Handy-Ansicht auf dem iPhone', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  });

  test('„App installieren" zeigt die Anleitung zum Home-Bildschirm', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-sidebar-toggle').click();
    await expect(page.locator('#btn-install-app')).toBeVisible();
    await page.locator('#btn-install-app').click();
    await expect(page.locator('#install-ios-overlay')).toBeVisible();
    await expect(page.locator('#install-ios-overlay')).toContainText('Home-Bildschirm');
    await page.locator('#install-ios-close').click();
    await expect(page.locator('#install-ios-overlay')).toBeHidden();
  });
});

// Galaxy S20 & Co. (360 px breit): Funktionsname stand nur als "H…" da —
// Hell/Dunkel und das "+" am Logo blieben trotz Handy-Regel sichtbar
// (spezifischere Desktop-Selektoren) und nahmen ihm den Platz.
test.describe('Handy-Ansicht, schmales Gerät (360 px)', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('Funktionsname steht vollständig in der Kopfzeile — auch angemeldet und mit Betrieb', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await expect(page.locator('#theme-toggle')).toBeHidden();
    await expect(page.locator('#brand-logo .ff-plus')).toBeHidden();

    const titleFits = () => page.evaluate(() => {
      const t = document.getElementById('current-view-title');
      const bar = document.getElementById('tabbar');
      return t.scrollWidth <= t.clientWidth && bar.scrollWidth <= bar.clientWidth;
    });
    for (const withBetrieb of [false, true]) {
      if (withBetrieb) {
        await page.evaluate(() => {
          const b = document.getElementById('btn-betrieb');
          b.classList.add('active');
          b.querySelector('.btn-betrieb-name').textContent = 'Obsthof Huber GbR';
          b.querySelector('.betrieb-empty-icon').outerHTML = '<span class="betrieb-avatar">O</span>';
        });
      }
      for (const view of ['obstbaum', 'kontrolle', 'compare', 'hofplan']) {
        await openFunction(page, view);
        expect(await titleFits(), `${view}, Betrieb: ${withBetrieb}`).toBe(true);
      }
    }
    // Unter 600 px zeigt der Betriebs-Chip nur den Avatar (Name per aria-label/title).
    await expect(page.locator('#btn-betrieb .btn-betrieb-name')).toBeHidden();
    await expect(page.locator('#btn-betrieb .betrieb-avatar')).toBeVisible();
  });
});
